import { test } from 'node:test';
import assert from 'node:assert/strict';

const key = 'senlings_v0';
const fixture = () => ({
  future: { keep: ['unknown'] },
  projects: [{ project_id: 'p', project_slug: 'TEST', future: 'keep', name: 42 }],
  contacts: [{ contact_id: 'CM01', name: '', active: true }],
  work_sessions: [{ id: 'w', project_id: 'p', check_in_at: Date.UTC(2026, 9, 1, 8), check_out_at: Date.UTC(2026, 9, 1, 17), break_minutes: 60 }],
  expenses: [{ id: 'e', project_id: 'p', expense_date: '2026-10-01', amount: 100 }],
  photos: [{ id: 'ph', project_id: 'p', filename: 'test.jpg' }],
  event_log: [], invoice_snapshots: [], current_session: { project_id: 'p', check_in_at: 1000 },
});
function storage(raw) {
  const mock = { raw, writes: 0, reads: 0, readError: false, writeError: false,
    getItem(k) { assert.equal(k, key); this.reads++; if (this.readError) throw Error('denied'); return this.raw; },
    setItem(k, v) { assert.equal(k, key); this.writes++; if (this.writeError) throw Error('quota'); this.raw = v; },
    removeItem() { throw Error('Unexpected removal'); },
  };
  globalThis.localStorage = mock;
  return mock;
}
for (const base of ['../web/src/pwa/', '../src/pwa/']) {
  const s = await import(base + 'storage.js');
  const project = await import(base + 'project.js');
  const work = await import(base + 'work.js');
  const expense = await import(base + 'expense.js');
  const photo = await import(base + 'photo.js');
  const contact = await import(base + 'contact.js');
  const invoice = await import(base + 'invoice.js');
  const paths = {
    start: () => s.update(d => ({ ...d, current_session: { project_id: 'p', check_in_at: 2000 } })),
    cancel: () => s.update(d => ({ ...d, current_session: null })),
    returnSession: () => work.saveSession({ ...fixture().work_sessions[0], id: 'w2' }),
    addSite: () => s.update(d => { d.projects.push({ project_id: 'new', project_slug: 'NEW' }); return d; }),
    saveProject: () => project.saveProject({ project_id: 'new', project_slug: 'NEW' }),
    archiveProject: () => project.archiveProject('p'),
    updateProject: () => project.updateProject('p', { address: 'test' }),
    saveExpense: () => expense.saveExpense({ ...fixture().expenses[0], id: 'e2' }),
    updateExpense: () => expense.updateExpense('e', { amount: 200 }),
    deleteExpense: () => expense.deleteExpense('e'),
    skip: () => expense.setClaimStatus('p', 2026, 10, 'skipped'),
    invoice: () => invoice.generateSnapshot({ snapshot_id: 'i', project_id: 'p', year: 2026, month: 10 }),
    savePhoto: () => photo.savePhotoMeta({ id: 'new', project_id: 'p' }),
    deletePhoto: () => photo.deletePhoto('ph'),
    updateContact: () => contact.updateContact('CM01', { name: 'TEST' }),
    seed: () => contact.ensureContactSeed(),
    event: () => s.update(d => { d.event_log.push({ type: 'ARRIVED_ON_SITE' }); return d; }),
    directSave: () => s.save(fixture()),
  };
  test(base + ' absent/read-only, defaults and unknown fields', () => {
    const m = storage(null);
    assert.equal(s.read().status, 'absent');
    assert.deepEqual(s.load().projects, []);
    assert.equal(m.writes, 0);
    assert.equal(contact.getActiveContacts().length, 10);
    assert.equal(m.writes, 0);
    project.saveProject({ project_id: 'p', project_slug: 'TEST' });
    assert.equal(s.read().status, 'valid');
    m.raw = JSON.stringify(fixture());
    assert.equal(work.monthlySummary('p', 2026, 10).total_work_minutes, 480);
    expense.setClaimStatus('p', 2026, 10, 'skipped');
    assert.equal(invoice.generateSnapshot({ snapshot_id: 'i', project_id: 'p', year: 2026, month: 10 }).total_work_minutes, 480);
    assert.deepEqual(s.load().future, fixture().future);
    assert.equal(s.load().projects[0].future, 'keep');
    assert.equal(s.load().projects[0].name, 42);
  });
  for (const [name, mutate] of Object.entries(paths)) {
    test(base + name + ' rejects unreadable / late failure / write failure; normal write preserves unknowns', () => {
      const invalid = [...Object.keys(fixture()).filter(k => Array.isArray(fixture()[k])).flatMap(k => [JSON.stringify({[k]: null}), JSON.stringify({[k]: [null]}), JSON.stringify({[k]: [3]}), JSON.stringify({[k]: {}})]), '', '{', 'null', '[]', 'true', '0', '"text"', '{"projects":{}}', '{"projects":null}', '{"projects":[{"project_id":"p","project_slug":"TEST","archive":"false"}]}', '{"expenses":[null]}', '{"work_sessions":[{}]}', '{"current_session":[]}', '{"current_session":{"project_id":"p","check_in_at":"bad"}}'];
      for (const raw of invalid) {
        const m = storage(raw);
        assert.equal(s.read().status, 'unreadable');
        assert.throws(mutate, s.StorageReadError);
        assert.equal(m.writes, 0);
        assert.equal(m.raw, raw);
      }
      for (const mode of ['readError', 'corruptAfterLoad', 'writeError']) {
        const original = JSON.stringify(fixture());
        const m = storage(original);
        s.load();
        if (mode === 'corruptAfterLoad') m.raw = '{'; else m[mode] = true;
        const before = m.raw;
        assert.throws(mutate, mode === 'writeError' ? s.StorageWriteError : s.StorageReadError);
        assert.equal(m.writes, mode === 'writeError' ? 1 : 0);
        assert.equal(m.raw, before);
      }
      const m = storage(JSON.stringify(fixture()));
      mutate();
      assert.equal(m.writes, 1);
      assert.deepEqual(s.load().future, fixture().future);
      assert.equal(s.load().projects[0].future, 'keep');
    assert.equal(s.load().projects[0].name, 42);
    });
  }
  test(base + ' rechecks after mutation callback, before setItem', () => {
    const m = storage(JSON.stringify(fixture()));
    const before = m.raw;
    assert.throws(() => s.update(d => { m.readError = true; return d; }), s.StorageReadError);
    assert.equal(m.writes, 0);
    assert.equal(m.raw, before);
  });
}
