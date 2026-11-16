// chizu.js — 地図。車の印を押す前に、どこへ行くのかを先に見せる。
//
// 2026-11-16 20:32 船長:「車のマークおすまえに、地図、ルートと駐車場所は、先に提示しておく。でないと怖くて押せないから。
//   みていて、前まで行けば警備の方が案内してくれます。」
// - 地図の絵は、国土地理院の地理院タイル(淡色地図)。鍵なし・無料。国土地理院のサーバーから、その場で読んで出す
//   (この使い方は、出典を出せば申請は要らない。出典は、地図が画面に出ている間、いつも見える所に)。
// - 取りに行くのは「行き先のあたりの絵」だけ。見ている人の位置は使わない・送らない。
// - 印(P など)は Senlings が上に重ねる。施設の図は、ここにも repo にも入れない(行き先の一点は、現場の案内から来る)。
// - 絵が一枚も取れないとき(圏外など)は、地図ごと出さない。車の印は、そのまま使える。
//
// 2026-11-17 船長「はい。仮で進めましょう。12月1日が現場がc工事に解放。うちの着工は12月14日頃。そのあたりで正解に。」
// - 現場の案内の「地図の印」の欄から、朝礼・トイレ・たばこ(と、二つ目の P)を読んで重ねる。
// - 印は人が置いた点だけ。書き方は一行に一つ「朝礼 33.59,130.32」(Googleマップで長押しした数字のまま)。
//   読めない行は出さない(当て推量で描かない)。道の線は、まだ描かない。
import { latLng } from './navi.js';

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

// ── 地図の印を読む ──
export const MARK_KINDS = Object.freeze({ p: '駐車場', chorei: '朝礼', toilet: 'トイレ', tabako: 'たばこ' });
const MARK_WORDS = [[/^(?:P|Ｐ|駐車場?|パーキング)/i, 'p'], [/^朝礼/, 'chorei'], [/^(?:トイレ|WC|便所|お手洗い)/i, 'toilet'], [/^(?:たばこ|タバコ|煙草|喫煙所?)/, 'tabako']];
export const MAX_MARKS = 16;
/** 「地図の印」の欄 → [{ kind, lat, lng }]。行は改行か「 / 」で区切る。読めない行は捨てる。 */
export function readMarks(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const part of text.split(/\s*\/\s*|\n/)) {
    const s = part.trim();
    const hit = s && MARK_WORDS.find(([re]) => re.test(s));
    if (!hit) continue;
    const at = latLng(s.replace(hit[0], '').replace(/[()\uFF08\uFF09]/g, ' ').replace(/^[\s:\uFF1A、,\uFF0C]+/, ''));
    if (!at) continue;
    const [lat, lng] = at.split(',').map(Number);
    out.push({ kind: hit[1], lat, lng });
    if (out.length >= MAX_MARKS) break;
  }
  return out;
}

// 印の絵。P(車を停める所)は青地に白の P。道路の駐車場の標識と同じ
function markP({ x, y }) {
  const g = svgEl('g', { class: 'chizu-mark chizu-p', transform: `translate(${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10})` });
  g.append(svgEl('circle', { r: 17, fill: '#0008' }), svgEl('circle', { r: 16, fill: '#fff' }), svgEl('circle', { r: 13.5, fill: '#1456c4' }));
  const t = svgEl('text', { y: 6.5, 'text-anchor': 'middle', 'font-size': 18, 'font-weight': 700, fill: '#fff', 'font-family': 'Arial, Helvetica, sans-serif' });
  t.textContent = 'P';
  g.append(t);
  return g;
}
// ほかの印は、色の丸に白い絵(文字を読まなくても分かるように)。朝礼=橙に「朝」、トイレ=紺に人の形、たばこ=茶に一本
const MARK_COLORS = Object.freeze({ chorei: '#d9822b', toilet: '#2f6e9e', tabako: '#6f6458' });
const r1 = v => Math.round(v * 10) / 10;
function markRound(kind, { x, y }) {
  const g = svgEl('g', { class: `chizu-mark chizu-${kind}`, transform: `translate(${r1(x)} ${r1(y)})` });
  g.append(svgEl('circle', { r: 15, fill: '#0008' }), svgEl('circle', { r: 14, fill: '#fff' }), svgEl('circle', { r: 11.5, fill: MARK_COLORS[kind] }));
  return g;
}
function markChorei(pt) {
  const g = markRound('chorei', pt);
  const t = svgEl('text', { y: 4.6, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 700, fill: '#fff' });
  t.textContent = '朝';
  g.append(t);
  return g;
}
function markToilet(pt) {
  const g = markRound('toilet', pt), w = { fill: '#fff' };
  g.append(svgEl('circle', { cx: -4.6, cy: -5.4, r: 1.9, ...w }), svgEl('rect', { x: -6.7, y: -3.2, width: 4.2, height: 5.4, rx: 1.2, ...w }),
    svgEl('rect', { x: -6.4, y: 1.8, width: 1.5, height: 5, ...w }), svgEl('rect', { x: -4.3, y: 1.8, width: 1.5, height: 5, ...w }),
    svgEl('circle', { cx: 4.6, cy: -5.4, r: 1.9, ...w }), svgEl('path', { d: 'M4.6 -3.4 L7.6 2.6 L1.6 2.6 Z', ...w }),
    svgEl('rect', { x: 3.1, y: 2.2, width: 1.3, height: 4.6, ...w }), svgEl('rect', { x: 4.8, y: 2.2, width: 1.3, height: 4.6, ...w }),
    svgEl('rect', { x: -0.4, y: -7.2, width: 0.8, height: 14, ...w }));
  return g;
}
function markTabako(pt) {
  const g = markRound('tabako', pt);
  g.append(svgEl('rect', { x: -7.5, y: 0.8, width: 13, height: 3.4, rx: 0.8, fill: '#fff' }), svgEl('rect', { x: -7.5, y: 0.8, width: 3.6, height: 3.4, rx: 0.8, fill: '#e3b07a' }),
    svgEl('rect', { x: 5.5, y: 0.8, width: 2, height: 3.4, rx: 0.6, fill: '#ff8a4c' }));
  for (const dx of [2.2, 5.2]) g.append(svgEl('path', { d: `M${dx} -0.6 C${dx - 2} -2.8 ${dx + 2} -4.4 ${dx} -7.2`, fill: 'none', stroke: '#fff', 'stroke-width': 1.2, 'stroke-linecap': 'round' }));
  return g;
}
const DRAW_MARK = Object.freeze({ p: markP, chorei: markChorei, toilet: markToilet, tabako: markTabako });

/**
 * 地図を描く。marks: [{ kind: 'p'|'chorei'|'toilet'|'tabako', lat, lng }]。描けたら true。
 * el は入れもの(hidden を持つ)。点が無いとき・絵が一枚も取れないときは、el ごと隠す。
 */
export function renderChizu(el, marks, { label } = {}) {
  el.replaceChildren();
  const ms = (Array.isArray(marks) ? marks : []).filter(usable);
  const plan = chizuPlan(ms);
  el.hidden = !plan;
  if (!plan) return false;
  const box = Object.assign(document.createElement('div'), { className: 'chizu' });
  box.style.paddingBottom = pct(plan.h / plan.w * 100); // 高さは幅から(古い端末でも効く書き方)
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', label ?? `地図(${[...new Set(ms.map(m => MARK_KINDS[m.kind]).filter(Boolean))].join('・') || '車の行き先'})`);
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
  // P は最後に重ねる(車の行き先が、ほかの印に隠れないように)
  const order = ms.map((_, i) => i).sort((a, b) => (ms[a].kind === 'p') - (ms[b].kind === 'p') || a - b);
  for (const i of order) { const draw = DRAW_MARK[ms[i].kind]; if (draw) svg.append(draw(plan.pts[i])); }
  box.append(svg, Object.assign(document.createElement('span'), { className: 'chizu-shutten', textContent: SHUTTEN }));
  el.append(box);
  return true;
}
