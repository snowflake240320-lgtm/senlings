// 地図(車の印を押す前に、どこへ行くのかを見せる)。画面に依らない割り付けだけ。点はすべて架空
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TILE, TILE_URL, SHUTTEN, worldPx, chizuPlan, tileUrl } from '../web/src/pwa/chizu.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≒ ${b}`);

test('地図:緯度と経度から世界のピクセルへ(別の式で出した数と合う)', () => {
  // 物差しは Python の asinh(tan(緯度)) の式で出した:35.5,135.25
  const a = worldPx(35.5, 135.25, 16);
  near(a.x, 14691714.844444444, 1e-5); near(a.y, 6616885.1343293125, 1e-5);
  const b = worldPx(35.5, 135.25, 17);
  near(b.x, 29383429.68888889, 1e-5); near(b.y, 13233770.268658625, 1e-5);
  const o = worldPx(0, 0, 0); near(o.x, 128); near(o.y, 128);
  const w = worldPx(0, -180, 3); near(w.x, 0);
});

test('地図:一点なら zoom 16。絵は行き先を真ん中に、6 枚で画面を覆う', () => {
  const p = chizuPlan([{ lat: 35.5, lng: 135.25 }]);
  assert.equal(p.z, 16); assert.equal(p.w, 360); assert.equal(p.h, 240);
  near(p.pts[0].x, 180, 0.5); near(p.pts[0].y, 120, 0.5);
  assert.deepEqual(p.tiles.map(t => `${t.x}/${t.y}@${t.left},${t.top}`), [
    '57388/25846@-207,-189', '57389/25846@49,-189', '57390/25846@305,-189',
    '57388/25847@-207,67', '57389/25847@49,67', '57390/25847@305,67']);
  // 覆い残しが無い:左上と右下が絵の中
  assert.ok(Math.min(...p.tiles.map(t => t.left)) <= 0 && Math.min(...p.tiles.map(t => t.top)) <= 0);
  assert.ok(Math.max(...p.tiles.map(t => t.left + TILE)) >= p.w && Math.max(...p.tiles.map(t => t.top + TILE)) >= p.h);
  assert.equal(tileUrl(p.tiles[1]), 'https://cyberjapandata.gsi.go.jp/xyz/pale/16/57389/25846.png');
});

test('地図:いくつか点があれば、全部が余白つきで入る一番大きい zoom を選ぶ', () => {
  const two = chizuPlan([{ lat: 35.5, lng: 135.25 }, { lat: 35.502, lng: 135.2535 }]);
  assert.equal(two.z, 16, 'zoom 17 では横にはみ出す(326px > 272px)');
  for (const q of two.pts) assert.ok(q.x >= 44 && q.x <= 360 - 44 && q.y >= 44 && q.y <= 240 - 44, 'inside the margin');
  near((two.pts[0].x + two.pts[1].x) / 2, 180, 0.6); near((two.pts[0].y + two.pts[1].y) / 2, 120, 0.6);
  const close = chizuPlan([{ lat: 35.5, lng: 135.25 }, { lat: 35.5003, lng: 135.2504 }]);
  assert.equal(close.z, 17, '近い二点は 17 まで寄る(それ以上は寄らない)');
  const far = chizuPlan([{ lat: 35.5, lng: 135.25 }, { lat: 36.5, lng: 137.25 }]);
  assert.ok(far.z >= 10 && far.z < 16);
});

test('地図:読めない点は捨てる。一つも無ければ描かない', () => {
  assert.equal(chizuPlan([]), null);
  assert.equal(chizuPlan(null), null);
  assert.equal(chizuPlan([{ lat: '35.5', lng: 135.25 }, { lat: NaN, lng: 1 }, { lat: 89, lng: 1 }, null]), null);
  assert.equal(chizuPlan([{ lat: 35.5, lng: 135.25 }, { lat: 200, lng: 1 }]).pts.length, 1);
});

test('地図:絵の出どころは地理院タイル一つ。出典の言葉を持つ。施設の位置はコードに無い', async () => {
  assert.equal(TILE_URL, 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png');
  assert.match(SHUTTEN, /地理院タイル/);
  const src = await readFile(new URL('../web/src/pwa/chizu.js', import.meta.url), 'utf8');
  assert.ok(!/\b3[0-9]\.\d{3,}\s*,\s*1[23][0-9]\.\d{3,}/.test(src), 'no real-looking coordinates in the code');
  assert.ok(!/geolocation/.test(src), 'the map does not ask where the person is');
});

// 地図の印(11-17 船長「はい。仮で進めましょう」)。点はすべて架空
import { readMarks, MARK_KINDS, MAX_MARKS } from '../web/src/pwa/chizu.js';
test('地図の印:一行に一つ「朝礼 緯度,経度」。Googleマップで長押しした数字のまま読める', () => {
  const marks = readMarks('朝礼 35.5001,135.2502 / トイレ 35.500200, 135.250300\nたばこ:35.5003,135.2504 / P(35.5004, 135.2505) / 駐車場 35.5005,135.2506 / 喫煙所 35.5006、135.2507 / WC 35.5007 135.2508');
  assert.deepEqual(marks.map(m => m.kind), ['chorei', 'toilet', 'tabako', 'p', 'p', 'tabako', 'toilet']);
  assert.deepEqual(marks[1], { kind: 'toilet', lat: 35.5002, lng: 135.2503 });
  assert.deepEqual(marks[3], { kind: 'p', lat: 35.5004, lng: 135.2505 });
  assert.deepEqual(Object.keys(MARK_KINDS), ['p', 'chorei', 'toilet', 'tabako']);
});
test('地図の印:読めない行は出さない(当て推量で描かない)。多すぎる点は切る', () => {
  assert.deepEqual(readMarks(''), []);
  assert.deepEqual(readMarks(null), []);
  assert.deepEqual(readMarks('朝礼は 8:20 から / トイレ 架空の東側 / 休憩所 35.5,135.25 / 35.5,135.25 / たばこ 95,135'), [], 'words, unknown kinds, bare numbers and impossible points are all left out');
  const many = Array.from({ length: 30 }, (_, i) => `トイレ 35.5,135.${2500 + i}`).join(' / ');
  assert.equal(readMarks(many).length, MAX_MARKS);
});
test('地図の印:人の居場所は読まない。印を読む決まりにも、位置を取りに行く言葉は無い', async () => {
  const src = await readFile(new URL('../web/src/pwa/chizu.js', import.meta.url), 'utf8');
  assert.ok(!/geolocation|watchPosition|getCurrentPosition/.test(src));
});
