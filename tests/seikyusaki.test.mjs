// 請求先(10-26):現場ごとに一つ。帳面はこの端末の中。請求書の宛先に載る
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listSeikyusaki, saveSeikyusaki, setProjectSeikyusaki, seikyusakiOf, billingBlock, seikyusakiFromEnvelope } from '../web/src/pwa/seikyusaki.js';
import { load, read, StorageReadError } from '../web/src/pwa/storage.js';
import { makeEnvelope } from '../web/src/pwa/envelope.js';

function storage(data = { projects: [{ project_id: 'p', project_slug: '架空の現場' }], work_sessions: [], expenses: [] }) {
  const mock = { raw: JSON.stringify(data), writes: 0,
    getItem(key) { return key === 'senlings_v0' ? this.raw : null; },
    setItem(key, raw) { assert.equal(key, 'senlings_v0'); this.raw = raw; this.writes++; } };
  globalThis.localStorage = mock; return mock;
}

test('save: company is required; whitespace tidied; same id updates; a site points at one; clearing keeps the book', () => {
  const m = storage();
  assert.throws(() => saveSeikyusaki({ company: '  ' }), /会社名/);
  assert.throws(() => saveSeikyusaki({ company: '架空', email: 'x' }), /メール/);
  const a = saveSeikyusaki({ company: ' 株式会社 架空建装 ', address: '〒111-0035  東京都台東区西浅草1-7-4', person: '架空の田中', phone: '03-0000-0000', email: 'a@example.test', line: '' });
  assert.match(a.id, /^sk[0-9a-f]{16}$/); assert.equal(a.company, '株式会社 架空建装'); assert.equal(a.address, '〒111-0035 東京都台東区西浅草1-7-4');
  const b = saveSeikyusaki({ id: a.id, company: '株式会社 架空建装', address: a.address, person: '架空の佐藤' });
  assert.equal(b.id, a.id); assert.equal(listSeikyusaki().length, 1); assert.equal(listSeikyusaki()[0].person, '架空の佐藤');
  saveSeikyusaki({ company: '別の元請け' }); assert.equal(listSeikyusaki().length, 2);
  setProjectSeikyusaki('p', a.id);
  const p = load().projects[0]; assert.equal(p.seikyusaki_id, a.id); assert.equal(seikyusakiOf(p).company, '株式会社 架空建装');
  assert.throws(() => setProjectSeikyusaki('p', 'sk0000000000000000'), /請求先が/);
  assert.throws(() => setProjectSeikyusaki('zz', a.id), /現場が/);
  setProjectSeikyusaki('p', null); assert.equal(seikyusakiOf(load().projects[0]), null); assert.equal(listSeikyusaki().length, 2, 'the book keeps it');
  assert.ok(m.writes >= 4);
});

test('billingBlock: 〒 line, address line, 会社名 御中; postal without hyphen gets one; no postal → address only', () => {
  assert.deepEqual(billingBlock({ company: '架空建装', address: '〒111-0035 東京都台東区西浅草1-7-4', person: '架空の田中' }),
    { postal: '〒111-0035', address: '東京都台東区西浅草1-7-4', company: '架空建装', honorific: '架空建装　御中', person: '架空の田中' });
  assert.equal(billingBlock({ company: 'x', address: '1110035 東京' }).postal, '〒111-0035');
  assert.deepEqual(billingBlock({ company: 'x', address: '東京都どこか' }), { postal: '', address: '東京都どこか', company: 'x', honorific: 'x　御中', person: '' });
  assert.equal(billingBlock(null), null);
});

test('from a 現場案内 envelope: the sender company, contact and phone become a draft (nothing saved)', () => {
  storage();
  const env = makeEnvelope({ kind: 'genba', from: '架空建装', date: '2026-12-01', site: { name: '架空の現場', contact: '架空の田中', contact_phone: '03-0000-0000' } });
  assert.deepEqual(seikyusakiFromEnvelope(env), { company: '架空建装', address: '', person: '架空の田中', phone: '03-0000-0000', email: '', line: '' });
  assert.equal(seikyusakiFromEnvelope(makeEnvelope({ kind: 'ouen', from: 'x', date: '2026-12-01', site: { name: 'y' } })), null);
  assert.equal(listSeikyusaki().length, 0);
});

test('guard: a broken 請求先 record makes the store unreadable, not silently dropped', () => {
  storage({ projects: [], work_sessions: [], expenses: [], seikyusaki: [{ id: 'sk', company: 5 }] });
  assert.equal(read().status, 'unreadable'); assert.throws(() => load(), StorageReadError);
  storage({ projects: [{ project_id: 'p', project_slug: 'x', seikyusaki_id: 7 }], work_sessions: [], expenses: [] });
  assert.equal(read().status, 'unreadable'); assert.throws(() => load(), StorageReadError);
});
