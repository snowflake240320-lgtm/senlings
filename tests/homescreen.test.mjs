// ホーム画面に置く(10-25)。iPhone の版・LINE の中・Android で、出す手順が変わる。ホーム画面からは出さない。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homeScreenState, homeScreenSteps, safariLink } from '../web/src/pwa/homeScreen.js';

const ios = v => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.split('_')[0]}.0 Mobile/15E148 Safari/604.1`;
const st = (ua, extra = {}) => homeScreenState({ ua, standalone: false, ...extra });

test('iOS 26 (compact tab bar): the first tap is 「…」, five taps', () => {
  const s = st(ios('26_0'));
  assert.equal(s.kind, 'ios'); assert.equal(s.major, 26); assert.equal(s.compact, true); assert.equal(s.inLine, false);
  const t = homeScreenSteps(s);
  assert.equal(t.steps.length, 5); assert.match(t.steps[0].text, /「…」/); assert.equal(t.steps[0].pic, 'safari26'); assert.equal(t.steps[2].pic, 'more'); assert.match(t.steps[2].text, /表示を増やす/); assert.equal(t.steps[3].pic, 'sheet'); assert.match(t.steps[4].text, /追加/);
});

test('iOS 18 and earlier: share first, then 表示を増やす, four taps', () => {
  const t = homeScreenSteps(st(ios('18_6')));
  assert.equal(t.steps.length, 4); assert.match(t.steps[0].text, /共有/); assert.equal(t.steps[0].pic, 'safari18'); assert.doesNotMatch(t.steps[0].text, /…/); assert.equal(t.steps[1].pic, 'more');
});

test('inside LINE: cannot add; send them to Safari with LINE\'s own switch', () => {
  const s = st(ios('26_0') + ' Line/15.2.0');
  assert.equal(s.inLine, true);
  const t = homeScreenSteps(s);
  assert.equal(t.safari, true); assert.match(t.steps[0].text, /Safari で開く/);
  assert.equal(safariLink({ origin: 'https://x.example', pathname: '/' }), 'https://x.example/?openExternalBrowser=1');
});

test('Chrome on iPhone: share is at the top right, with its own picture', () => {
  const s = st(ios('18_6').replace('Version/18.0', 'CriOS/130.0'));
  assert.equal(s.chrome, true); assert.equal(s.otherBrowser, true);
  const t = homeScreenSteps(s);
  assert.equal(t.steps.length, 4); assert.match(t.steps[0].text, /右上/); assert.equal(t.steps[0].pic, 'chrome');
});

test('Android: one button when the browser offers it, otherwise the menu steps', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
  assert.equal(homeScreenSteps(st(ua, { installPrompt: {} })).button, 'ホーム画面に置く');
  assert.match(homeScreenSteps(st(ua)).steps[0].text, /⋮/);
});

test('already on the home screen, or a desktop: nothing to show', () => {
  assert.equal(homeScreenSteps(homeScreenState({ ua: ios('26_0'), standalone: true })), null);
  assert.equal(homeScreenSteps(st('Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0')), null);
});
