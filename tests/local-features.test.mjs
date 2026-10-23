import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTransfer, inspectTransfer, acceptTransfer } from '../web/src/pwa/projectTransfer.js';
import { saveLocalRecord, contactPhone } from '../web/src/pwa/localRecords.js';
import { saveSettingsFromForm, getSetting, SETTINGS_KEYS } from '../web/src/pwa/settings.js';
import { StorageReadError, StorageWriteError, load } from '../web/src/pwa/storage.js';
const project = { project_id: 'source', project_slug: '架空現場', address: '架空住所', site_info: { raw: '原文\nそのまま', contact: '架空担当者', contact_phone: '000-0000-0000' }, secret: 'PRIVATE' };
const packet = (revision = 1) => JSON.stringify(makeTransfer(project, ['address', 'raw', 'contact', 'contact_phone'], revision));
const fixture = () => ({ projects: [{ project_id: 'old', project_slug: '既存' }], work_sessions: [{ id: 'w', project_id: 'old', check_in_at: 10, check_out_at: 20, break_minutes: 0 }],
  invoice_snapshots: [{ snapshot_id: 'i', project_id: 'old', source_hash: 'frozen' }], expenses: [], photos: [{ id: 'p', project_id: 'old', thumbnail: 'KEEP' }], future: { exact: true } });
function storage(data = fixture()) {
  const mock = { raw: JSON.stringify(data), writes: 0, fail: false, legacy: new Map(),
    getItem(key) { return key === 'senlings_v0' ? this.raw : this.legacy.get(key) ?? null; },
    setItem(key, raw) { assert.equal(key, 'senlings_v0'); if (this.fail) throw Error('quota'); this.raw = raw; this.writes++; } };
  globalThis.localStorage = mock; return mock;
}
test('handoff exports only explicitly selected property fields', () => {
  const p = makeTransfer({ ...project, local_records: [{ text: 'PRIVATE' }] }, ['address', 'secret']);
  assert.deepEqual(p.project, { name: project.project_slug, address: project.address });
  assert.ok(!JSON.stringify(p).includes('PRIVATE'));
  assert.deepEqual(makeTransfer(project, []).project, { name: project.project_slug });
});
test('preview is read-only; accept and repeated receive retain other records exactly', () => {
  const m = storage(), before = load();
  assert.equal(inspectTransfer(packet()).action, 'add'); assert.equal(m.writes, 0);
  acceptTransfer(packet(), 'local', 100);
  assert.equal(load().projects.length, 2); assert.equal(load().projects[1].site_info.raw, project.site_info.raw);
  assert.equal(load().handoff_receipts[0].raw, packet());
  for (const key of ['work_sessions', 'invoice_snapshots', 'expenses', 'photos', 'future']) assert.deepEqual(load()[key], before[key]);
  const raw = m.raw; assert.equal(acceptTransfer(packet(), 'another', 200).action, 'received');
  assert.equal(m.raw, raw); assert.equal(m.writes, 1);
});
test('new revision updates selected property fields, preserving the local name, originals and private records', () => {
  storage(); acceptTransfer(packet(), 'local', 100);
  const current = load(); current.projects[1].site_info.toilet = '自分で確認'; current.projects[1].my_field = 'keep'; localStorage.raw = JSON.stringify(current);
  const revised = makeTransfer({ ...project, project_slug: '訂正後' }, ['raw'], 2);
  const plan = inspectTransfer(JSON.stringify(revised));
  assert.equal(plan.action, 'update'); assert.equal(plan.current_slug, project.project_slug);
  acceptTransfer(JSON.stringify(revised), 'unused', 200, { slug: '更新時は無視される' });
  assert.equal(load().projects.length, 2);
  // 表札は職人のもの:送り手の新しい現場名では書き換えない。送り手の名前は別に残る。
  assert.equal(load().projects[1].project_slug, project.project_slug);
  assert.deepEqual(load().projects[1].handoff_source, { source_project_id: project.project_id, revision: 2, name: '訂正後' });
  assert.equal(load().projects[1].site_info.toilet, '自分で確認'); assert.equal(load().projects[1].my_field, 'keep');
  assert.equal(load().handoff_receipts.length, 2); assert.equal(load().handoff_receipts[0].raw, packet());
});
test('first receive lets the craftsman choose the local name; blank keeps the sender name; sender name is kept separately', () => {
  storage(); acceptTransfer(packet(), 'named', 100, { slug: '  自分の呼び名  ' });
  assert.equal(load().projects[1].project_slug, '自分の呼び名'); assert.equal(load().projects[1].handoff_source.name, project.project_slug);
  const other = JSON.stringify(makeTransfer({ ...project, project_id: 'source-2' }, [], 1));
  acceptTransfer(other, 'blank', 200, { slug: '   ' });
  assert.equal(load().projects[2].project_slug, project.project_slug);
  const m = localStorage, before = m.raw;
  assert.throws(() => acceptTransfer(JSON.stringify(makeTransfer({ ...project, project_id: 'source-3' }, [], 1)), 'bad', 300, { slug: 'x'.repeat(201) }));
  assert.equal(m.raw, before);
});
test('conflicting identity/version, older version and malformed packets cannot overwrite saved data', () => {
  const m = storage(); acceptTransfer(packet(2), 'local', 100); const before = m.raw;
  const conflict = JSON.parse(packet(2)); conflict.project.name = '別内容';
  for (const raw of ['{', '{}', JSON.stringify({ ...JSON.parse(packet()), private_records: ['hidden'] }), packet(1), JSON.stringify(conflict), JSON.stringify({ ...JSON.parse(packet()), revision: 1.5 })]) {
    assert.throws(() => acceptTransfer(raw)); assert.equal(m.raw, before);
  }
});
test('write failure leaves neither property nor receipt; retry writes both once', () => {
  const m = storage(), before = m.raw; m.fail = true;
  assert.throws(() => acceptTransfer(packet(), 'local', 100), StorageWriteError); assert.equal(m.raw, before);
  m.fail = false; acceptTransfer(packet(), 'local', 100); acceptTransfer(packet(), 'local', 100);
  assert.equal(load().projects.length, 2); assert.equal(load().handoff_receipts.length, 1);
});
test('unreadable optional collections stop all writes', () => {
  for (const extra of [{ local_records: {} }, { handoff_receipts: [{ packet: null }] }, { settings: [] }]) {
    const m = storage({ ...fixture(), ...extra }), before = m.raw;
    assert.throws(() => acceptTransfer(packet()), StorageReadError); assert.equal(m.raw, before); assert.equal(m.writes, 0);
  }
});
test('memo and SOS are private, explicitly unsent, recover after quota failure without duplication', () => {
  const m = storage(), before = m.raw; const note = { id: 'n', project_id: 'old', kind: 'memo', text: '自分の工夫', created_at: 100 };
  m.fail = true; assert.throws(() => saveLocalRecord(note), StorageWriteError); assert.equal(m.raw, before);
  m.fail = false; saveLocalRecord(note); saveLocalRecord(note);
  saveLocalRecord({ ...note, id: 's', kind: 'sos', field_key: 'danger', text: '足場を確認したい', delivery_status: 'delivered' });
  assert.equal(load().local_records.length, 2);
  for (const r of load().local_records) { assert.equal(r.visibility, 'private'); assert.equal(r.delivery_status, 'not_sent'); }
  assert.deepEqual(load().future, { exact: true });
});
test('telephone action only allows explicit numeric phone numbers', () => {
  assert.equal(contactPhone(project), '00000000000');
  for (const text of ['', 'javascript:alert(1)', 'tel:123', '担当者へ']) assert.equal(contactPhone({ site_info: { contact_phone: text } }), null);
});
test('settings save is atomic, preserves old keys, supports existing values and full-data export', () => {
  const m = storage(); m.legacy.set(SETTINGS_KEYS.USER_NAME, '以前の名前'); assert.equal(getSetting(SETTINGS_KEYS.USER_NAME), '以前の名前');
  const before = m.raw; m.fail = true;
  assert.throws(() => saveSettingsFromForm({ [SETTINGS_KEYS.USER_NAME]: '新しい名前' }), StorageWriteError); assert.equal(m.raw, before);
  m.fail = false; saveSettingsFromForm({ [SETTINGS_KEYS.USER_NAME]: '新しい名前', [SETTINGS_KEYS.WORK_UNIT_PRICE]: '12345' });
  assert.equal(getSetting(SETTINGS_KEYS.USER_NAME), '新しい名前'); assert.equal(m.legacy.get(SETTINGS_KEYS.USER_NAME), '以前の名前');
  assert.equal(JSON.parse(m.raw).settings.senlings_work_unit_price, '12345');
  const saved = m.raw; assert.throws(() => saveSettingsFromForm({ [SETTINGS_KEYS.TAX_RATE]: 'NaN' })); assert.equal(m.raw, saved);
});
for (const base of ['../web/src/pwa/', '../src/pwa/']) {
  const { completeSession } = await import(base + 'work.js');
  test(base + 'new return note persists atomically and interrupted legacy attendance remains unchanged', () => {
    const original = fixture(); const old = { id: 'legacy', project_id: 'old', check_in_at: 1000, check_out_at: 2000, break_minutes: 0, extra: 'KEEP' };
    original.work_sessions.push(old); original.current_session = { project_id: 'old', check_in_at: 1000 };
    const m = storage(original); const requested = { ...old, id: 'retry', check_out_at: 3000, personal_note: { text: '工夫', mood: 'positive', categories: ['hinshitsu'] } };
    m.fail = true; const raw = m.raw; assert.throws(() => completeSession(requested), { name: 'StorageWriteError' }); assert.equal(m.raw, raw);
    m.fail = false; completeSession(requested); completeSession(requested);
    assert.deepEqual(load().work_sessions.at(-1), old); assert.equal(load().work_sessions.length, 2);
    assert.equal(load().local_records.length, 1); assert.equal(load().local_records[0].text, '工夫'); assert.equal(load().current_session, null);
  });
}
