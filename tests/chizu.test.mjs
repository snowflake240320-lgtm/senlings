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
