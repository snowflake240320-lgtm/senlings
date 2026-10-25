// 封筒(10-25)。応援も元請けの依頼も同じ封筒一通。文は人が読め、いちばん下の一行だけが Senlings 用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnvelope, envelopeText, findEnvelope, envelopeToTransfer, bodyOf, dayLabel, TOKEN_MARK } from '../web/src/pwa/envelope.js';
import { parseTransfer } from '../web/src/pwa/projectTransfer.js';

process.env.TZ = 'Asia/Tokyo';
const site = { name: 'サイゼリヤ田原町', start: '08:00', end: '17:00', address: '架空の住所', morning_assembly: '8:20', parking: '屋上', contact: '架空の担当', contact_phone: '000-0000-0000', source_id: 'p1', revision: 3 };

test('round trip through text: the person reads it, Senlings reads the last line', () => {
  const env = makeEnvelope({ kind: 'ouen', from: '園原', date: '2026-10-25', work_date: '2026-10-27', note: 'ボードの手が足りません', site });
  const text = envelopeText(env, { link: 'https://x.example/?openExternalBrowser=1' });
  const lastLine = text.split('\n').at(-1);
  assert.match(text, /^【応援のお願い】園原より\n10\/27\(火\)、サイゼリヤ田原町 に来てもらえませんか。/);
  assert.match(text, /時間:8:00〜17:00/); assert.match(text, /担当:架空の担当\n電話:000-0000-0000/);
  assert.ok(lastLine.length < 220, `short line: ${lastLine.length}`); assert.match(lastLine, /^〔Senlings〕[A-Za-z0-9_-]+$/);
  assert.match(text, /まだの人は → https:\/\/x\.example\/\?openExternalBrowser=1/);
  assert.ok(lastLine.startsWith(TOKEN_MARK));
  // LINE は前後に文を足したり、改行を変えたりする。それでも読める
  const pasted = `[LINE] 園原\n${text.replace(/\n/g, '\r\n')}\n既読`;
  assert.deepEqual(findEnvelope(pasted), env);
  assert.doesNotMatch(bodyOf(text), /〔Senlings〕/);
});

test('元請けの依頼 is the same envelope, only kind and sender differ', () => {
  const env = makeEnvelope({ kind: 'genba', from: '藤田建装 統括 園原', date: '2026-10-25', work_date: '2026-12-01', site });
  assert.match(envelopeText(env), /^【現場のご案内】藤田建装 統括 園原より\n12\/1\(火\)、サイゼリヤ田原町 をお願いします。/);
  assert.equal(findEnvelope(envelopeText(env)).kind, 'genba');
});

test('to a handoff packet: same safety (version, nameplate), the person-readable body kept as the original', () => {
  const env = makeEnvelope({ kind: 'ouen', from: '園原', date: '2026-10-25', site });
  const text = envelopeText(env);
  const packet = parseTransfer(JSON.stringify(envelopeToTransfer(env, text)));
  assert.equal(packet.source_project_id, 'p1'); assert.equal(packet.revision, 3);
  assert.equal(packet.project.name, 'サイゼリヤ田原町'); assert.equal(packet.project.parking, '屋上');
  assert.match(packet.project.raw, /応援のお願い/); assert.doesNotMatch(packet.project.raw, /〔Senlings〕/);
  assert.equal(Object.hasOwn(packet.project, 'start'), false, 'times go to the site rule, not the original');
});

test('nothing private rides along; unknown keys and broken shapes stop', () => {
  assert.throws(() => makeEnvelope({ kind: 'ouen', from: 'x', date: '2026-10-25', site: { name: '' } }), /現場名/);
  assert.throws(() => makeEnvelope({ kind: 'ouen', from: 'x', date: '2026-10-25', site: { name: 'a', start: '17:00', end: '08:00' } }), /時間/);
  assert.throws(() => makeEnvelope({ kind: 'nope', from: 'x', date: '2026-10-25', site: { name: 'a' } }));
  const env = makeEnvelope({ kind: 'ouen', from: 'x', date: '2026-10-25', site: { name: 'a', memo: '自分のメモ', photos: ['p'] } });
  assert.deepEqual(Object.keys(env.site).sort(), ['name', 'revision', 'source_id']);
  // 本文が変わっていたら(一文字でも)、読まずに止める
  const text = envelopeText(makeEnvelope({ kind: 'ouen', from: 'x', date: '2026-10-25', site }));
  assert.throws(() => findEnvelope(text.replace('屋上', '地下')), /まるごとコピー/);
  assert.throws(() => findEnvelope(text.split('\n').filter(l => !l.startsWith('朝礼')).join('\n')), /まるごとコピー/);
});

test('a cut-off last line says so plainly; text without the line is not an envelope', () => {
  const text2 = envelopeText(makeEnvelope({ kind: 'ouen', from: 'x', date: '2026-10-25', site }));
  assert.throws(() => findEnvelope(text2.slice(0, -10)), /まるごとコピー/);
  assert.equal(findEnvelope('明日、田原町に来れる?'), null);
  assert.equal(dayLabel('2026-12-01'), '12/1(火)');
});

test('notes of several lines, no sender, and a site without hours all come back the same', () => {
  const env = makeEnvelope({ kind: 'genba', from: '', date: '2026-10-25', note: '一行目\n\n■ 二行目\n三行目', site: { name: '架空の現場', parking: '屋上\n2台まで' } });
  assert.equal(env.note, '一行目\n■二行目\n三行目'); assert.equal(env.site.parking, '屋上 / 2台まで');
  assert.deepEqual(findEnvelope(envelopeText(env)), env);
});

test('孫請けを守る:依頼の文には、単価・請求・勤怠・メモ・SOS・届いた原文が乗り得ない(端末の外へ出るのは現場の案内だけ)', async () => {
  const { siteFromProject } = await import('../web/src/pwa/requestUI.js');
  const project = { project_id: 'p1', project_slug: '架空の現場', address: '架空の住所', project_code: 'K-001',
    site_info: { parking: '屋上', raw: '元請けからの原文(単価 25,000円)', contact: '架空の担当' },
    unit_price: 25000, settings: { senlings_work_unit_price: '25000' }, personal_note: '自分のメモ' };
  const site = siteFromProject(project, { start: '08:00', end: '17:00' });
  assert.deepEqual(Object.keys(site).sort(), ['address', 'contact', 'end', 'name', 'parking', 'source_id', 'start']);
  const text = envelopeText(makeEnvelope({ kind: 'ouen', from: 'x', date: '2026-10-25', site }));
  for (const secret of ['25,000', '25000', 'K-001', '自分のメモ', '原文']) assert.equal(text.includes(secret), false, secret);
});
