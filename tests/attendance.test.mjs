import { test } from 'node:test';
import assert from 'node:assert/strict';

const session = () => ({ id: 'new-return', project_id: 'p', check_in_at: 2000, check_out_at: 9000, break_minutes: 0 });
const fixture = () => ({
  projects: [{ project_id: 'p', project_slug: '隔離現場', site_info: { raw: '原文\n保持' }, extra: { keep: true } }],
  contacts: [{ contact_id: 'c', name: '架空連絡先' }],
  work_sessions: [{ id: 'old', project_id: 'p', check_in_at: 500, check_out_at: 1000, break_minutes: 0, extra: 'keep' }],
  expenses: [{ id: 'e', project_id: 'p', expense_date: '2026-10-20', amount: 100 }],
  photos: [{ id: 'ph', project_id: 'p', filename: 'fake.jpg' }],
  invoice_snapshots: [{ snapshot_id: 'i', project_id: 'p', source_hash: 'frozen', amount: 100 }],
  event_log: [{ type: 'KEEP', extra: true }],
  future: { keep: ['unknown', 42] },
  current_session: { project_id: 'p', check_in_at: 2000, extra: 'keep-until-completion' },
});
function storage(data) {
  const mock = { raw: JSON.stringify(data), writes: 0, reads: 0, failWrite: false, failRead: 0,
    getItem(key) { assert.equal(key, 'senlings_v0'); if (++this.reads === this.failRead) throw Error('read failure'); return this.raw; },
    setItem(key, value) { assert.equal(key, 'senlings_v0'); this.writes++; if (this.failWrite) throw Error('quota'); this.raw = value; },
  };
  globalThis.localStorage = mock;
  return mock;
}
const withoutCurrent = data => ({ ...data, current_session: null });

for (const base of ['../web/src/pwa/', '../src/pwa/']) {
  const { completeSession, SessionCompletionError } = await import(base + 'work.js');
  const { StorageReadError, StorageWriteError } = await import(base + 'storage.js');

  test(base + 'normal checkout saves attendance and clears entry together, preserving all other data', () => {
    const original = fixture(), m = storage(original), done = session();
    completeSession(done);
    assert.equal(m.writes, 1);
    assert.deepEqual(JSON.parse(m.raw), { ...withoutCurrent(original), work_sessions: [...original.work_sessions, done] });
  });
  test(base + 'quota failure leaves exact bytes unchanged; retry adds only one attendance', () => {
    const m = storage(fixture()), before = m.raw;
    m.failWrite = true;
    assert.throws(() => completeSession(session()), StorageWriteError);
    assert.equal(m.raw, before);
    m.failWrite = false;
    completeSession(session());
    assert.equal(JSON.parse(m.raw).work_sessions.length, 2);
    assert.equal(JSON.parse(m.raw).current_session, null);
  });
  test(base + 'late unreadable recheck stops all writes', () => {
    const m = storage(fixture()), before = m.raw;
    m.failRead = 2;
    assert.throws(() => completeSession(session()), StorageReadError);
    assert.equal(m.raw, before);
    assert.equal(m.writes, 0);
  });
  test(base + 'legacy partial checkout retains saved id, checkout, breaks, travel and unknown fields', () => {
    const original = fixture();
    const saved = { ...session(), id: 'legacy', check_out_at: 8000, break_minutes: 15, travel_start_at: 100, travel_end_at: 200, extra: { keep: true } };
    original.work_sessions.push(saved);
    const m = storage(original);
    assert.deepEqual(completeSession(session()), saved);
    assert.deepEqual(JSON.parse(m.raw), withoutCurrent(original));
    assert.equal(m.writes, 1);
  });
  test(base + 'legacy recovery write failure preserves all bytes and remains retryable', () => {
    const original = fixture(); original.work_sessions.push(session());
    const m = storage(original), before = m.raw; m.failWrite = true;
    assert.throws(() => completeSession(session()), StorageWriteError);
    assert.equal(m.raw, before);
    m.failWrite = false; completeSession({ ...session(), id: 'retry', check_out_at: 10000 });
    assert.deepEqual(JSON.parse(m.raw), withoutCurrent(original));
  });
  test(base + 'repeat completion does not write or change the first attendance', () => {
    const m = storage(fixture()); completeSession(session());
    const before = m.raw, writes = m.writes;
    completeSession({ ...session(), id: 'retry', check_out_at: 10000 });
    assert.equal(m.raw, before); assert.equal(m.writes, writes);
  });
  test(base + 'already duplicated legacy records stop without deletion, merge or false completion', () => {
    for (const current of [true, false]) {
      const original = fixture(); original.work_sessions.push(session(), { ...session(), id: 'duplicate' });
      if (!current) original.current_session = null;
      const m = storage(original), before = m.raw;
      assert.throws(() => completeSession(session()), SessionCompletionError);
      assert.equal(m.raw, before); assert.equal(m.writes, 0);
    }
  });
  test(base + 'changed or canceled entry cannot be completed from a stale screen', () => {
    for (const current_session of [null, { project_id: 'other', check_in_at: 2000 }, { project_id: 'p', check_in_at: 3000 }]) {
      const m = storage({ ...fixture(), current_session }), before = m.raw;
      assert.throws(() => completeSession(session()), SessionCompletionError);
      assert.equal(m.raw, before); assert.equal(m.writes, 0);
    }
  });
  test(base + 'completed entry retry cannot clear a different active entry', () => {
    const original = fixture(); original.work_sessions.push(session()); original.current_session.check_in_at = 3000;
    const m = storage(original), before = m.raw;
    assert.throws(() => completeSession(session()), SessionCompletionError);
    assert.equal(m.raw, before); assert.equal(m.writes, 0);
  });
  test(base + 'different project at the same time and earlier entry in same project are retained', () => {
    const original = fixture(); original.work_sessions.push({ ...session(), id: 'other-project', project_id: 'other' });
    const m = storage(original); completeSession(session());
    assert.deepEqual(JSON.parse(m.raw), { ...withoutCurrent(original), work_sessions: [...original.work_sessions, session()] });
  });
}
