// 顔(どこまで見せるか)と、車の印(声の道案内)。画面にも保存にも依らないところだけ
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KAO_KEY, KAO_DEFAULT, kaoOf } from '../web/src/pwa/kao.js';
import { naviLink, trainLink, latLng } from '../web/src/pwa/navi.js';

test('顔:知らない値は既定に倒す。この枝の既定は「現場だけ」', () => {
  assert.equal(KAO_DEFAULT, 'genba');
  assert.equal(kaoOf('zenbu'), 'zenbu');
  assert.equal(kaoOf('genba'), 'genba');
  for (const v of [null, undefined, '', 'ZENBU', 'all', 1, {}]) assert.equal(kaoOf(v), KAO_DEFAULT);
  assert.equal(kaoOf(null, 'zenbu'), 'zenbu');
});

test('顔:index.html の頭の一行は、kao.js と同じ鍵・同じ既定(描く前に当てるため、二か所にある)', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(`var k = '${KAO_DEFAULT}';`), 'the inline default matches KAO_DEFAULT');
  assert.ok(html.includes(`localStorage.getItem('${KAO_KEY}')`), 'the inline key matches KAO_KEY');
  assert.ok(html.includes('document.documentElement.dataset.kao = k;'));
});

test('車の印:住所の文でも、緯度と経度でも、声の道案内のリンクになる。出発地は入れない', () => {
  const a = naviLink('架空市架空町 架空の駐車場');
  assert.equal(a, `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('架空市架空町 架空の駐車場')}&travelmode=driving&dir_action=navigate`);
  assert.ok(!a.includes('origin='));
  assert.equal(naviLink(' 35.5 , 135.25 '), 'https://www.google.com/maps/dir/?api=1&destination=35.5%2C135.25&travelmode=driving&dir_action=navigate');
  assert.equal(naviLink('35.5、135.25'), naviLink('35.5,135.25'));
  for (const v of ['', '   ', null, undefined, 12, {}]) assert.equal(naviLink(v), null);
  assert.equal(naviLink('x'.repeat(400)).length, naviLink('x'.repeat(300)).length, 'a long line is cut, not rejected');
  assert.equal(naviLink('一行目\n二行目'), naviLink('一行目 二行目'));
});

// 11-17 船長「歩きの人もいます。車マークと電車マークにしましょう」
test('電車の印:電車と歩きの道順のリンクになる。声の道案内にはしない。出発地は入れない', () => {
  const a = trainLink('架空市架空町 架空の駅前');
  assert.equal(a, `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('架空市架空町 架空の駅前')}&travelmode=transit`);
  assert.ok(!a.includes('origin=') && !a.includes('dir_action'), 'no origin, no voice navigation (the train is chosen from the routes)');
  assert.equal(trainLink(' 35.5 , 135.25 '), 'https://www.google.com/maps/dir/?api=1&destination=35.5%2C135.25&travelmode=transit');
  assert.equal(trainLink('35.5、135.25'), trainLink('35.5,135.25'));
  for (const v of ['', '   ', null, undefined, 12, {}]) assert.equal(trainLink(v), null);
  assert.equal(trainLink('一行目\n二行目'), trainLink('一行目 二行目'));
});

test('緯度と経度:範囲の外や、数字でないものは住所の文として扱う', () => {
  assert.equal(latLng('35.5,135.25'), '35.5,135.25');
  assert.equal(latLng('-33.5,-130.25'), '-33.5,-130.25');
  assert.equal(latLng('91,130'), null);
  assert.equal(latLng('33.5,181'), null);
  assert.equal(latLng('架空市架空町2-12'), null);
  assert.equal(latLng('2-12'), null);
  assert.ok(naviLink('91,130').includes(encodeURIComponent('91,130')), 'still usable as a plain query');
});
