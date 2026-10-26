// 知らせ(遅れます・休みます)と、いざというとき(人が倒れた・火事)の文(2026-10-25)。
// 送るのは人。文には、単価・請求・勤怠・メモは乗らない。宛先はこの現場の担当(越えない)。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yoyuu, showTime, okureText, yasumiText, sokuhouText, atena, mapsLink, smsLink, FUKU_NI_HI } from '../web/src/pwa/shirase.js';

process.env.TZ = 'Asia/Tokyo';

test('余裕をみた到着:Googleマップ +10分、5分単位で切り上げ(9:12 → 9:25)', () => {
  assert.equal(yoyuu('09:12'), '9:25');
  assert.equal(yoyuu('09:15'), '9:25');
  assert.equal(yoyuu('09:10'), '9:20');
  assert.equal(yoyuu('09:11'), '9:25');
  assert.equal(yoyuu('23:55'), '0:05', '日をまたいでも時計の形');
  assert.equal(showTime('08:05'), '8:05');
  assert.throws(() => yoyuu('9:1'), /到着時刻/);
});

test('呼びかけ:担当の名前に「さん」。無ければ「ご担当の方」。もう付いていれば重ねない', () => {
  assert.equal(atena('架空の田中'), '架空の田中さん');
  assert.equal(atena('架空の田中さん'), '架空の田中さん');
  assert.equal(atena('架空建設 様'), '架空建設 様');
  assert.equal(atena(''), 'ご担当の方');
  assert.equal(atena(undefined), 'ご担当の方');
});

test('遅れます:Googleマップの到着があれば「余裕をみて」を添える。事故渋滞。自分で決めた時刻だけでも書ける', () => {
  const t = okureText({ site: '架空の現場', contact: '架空の田中', me: '架空の職人', mapsAt: '09:12', jiko: true });
  assert.equal(t, '架空の田中さん\n架空の現場、事故渋滞で遅れます。すみません。\nGoogleマップでは 9:12 着、余裕をみて 9:25 ごろ着きます。\n架空の職人');
  const u = okureText({ site: '架空の現場', at: '10:00', note: '  部材を積み直しています  ' });
  assert.equal(u, 'ご担当の方\n架空の現場、遅れます。すみません。\n10:00 ごろ着きます。\n部材を積み直しています');
  assert.throws(() => okureText({ site: '架空の現場' }), /着く時刻/);
  assert.throws(() => okureText({ at: '10:00' }), /現場名/);
});

test('休みます:理由は聞かない。今日/日付。代わりを探していることを添えられる', () => {
  const t = yasumiText({ site: '架空の現場', date: '2026-12-02', today: '2026-12-01', contact: '架空の田中', me: '架空の職人', kawari: true });
  assert.equal(t, '架空の田中さん\n12/2(水)の架空の現場、休ませてください。申し訳ありません。\n代わりに入れる人を、こちらで当たっています。決まったら、また連絡します。\n架空の職人');
  const u = yasumiText({ site: '架空の現場', date: '2026-12-01', today: '2026-12-01' });
  assert.equal(u, 'ご担当の方\n今日の架空の現場、休ませてください。申し訳ありません。');
  assert.throws(() => yasumiText({ site: '架空の現場', date: '12/1', today: '2026-12-01' }), /休む日/);
});

test('速報:種類・時刻・現場・場所。人が倒れたら AED と 119 を頼む。火事は逃げてと 119', () => {
  const now = new Date('2026-12-01T10:07:00+09:00').getTime();
  assert.equal(sokuhouText({ kind: 'taore', site: '架空の現場', place: 'HB棟 2階', me: '架空の職人', now }),
    '【速報】人が倒れました(10:07)\n現場:架空の現場\n場所:HB棟 2階\nAED を持ってきてください。119 をお願いします。\n架空の職人');
  assert.equal(sokuhouText({ kind: 'kaji', site: '架空の現場', now }),
    '【速報】火事です(10:07)\n現場:架空の現場\n場所:(場所を書く)\n近くの人は逃げてください。119 をお願いします。');
  assert.doesNotMatch(sokuhouText({ kind: 'taore', site: 'x', aed: false, now }), /AED/);
  assert.throws(() => sokuhouText({ kind: 'other', now }), /種類/);
  assert.match(FUKU_NI_HI, /水はかけない/);
});

test('Googleマップと SMS の口:住所・番号が無ければ出さない', () => {
  assert.equal(mapsLink('福岡市東区香椎照葉1-1'), 'https://www.google.com/maps/dir/?api=1&destination=%E7%A6%8F%E5%B2%A1%E5%B8%82%E6%9D%B1%E5%8C%BA%E9%A6%99%E6%A4%8E%E7%85%A7%E8%91%891-1');
  assert.equal(mapsLink(''), null);
  assert.equal(smsLink(null, 'x'), null);
  assert.equal(smsLink('0900000000', 'a b'), 'sms:0900000000?&body=a%20b');
});

test('署名:会社・名前・電話が文の下に。無ければ呼び名だけ', () => {
  const sign = ['架空工業', '架空の職人', '090-1111-2222'];
  assert.equal(okureText({ site: '架空の現場', at: '10:00', sign }), 'ご担当の方\n架空の現場、遅れます。すみません。\n10:00 ごろ着きます。\n架空工業\n架空の職人\n090-1111-2222');
  assert.equal(yasumiText({ site: '架空の現場', date: '2026-12-01', today: '2026-12-01', me: '呼び名', sign: [] }).split('\n').pop(), '呼び名');
  assert.match(sokuhouText({ kind: 'kaji', site: 'x', sign, now: new Date('2026-12-01T10:07:00+09:00').getTime() }), /119 をお願いします。\n架空工業\n架空の職人\n090-1111-2222$/);
});
