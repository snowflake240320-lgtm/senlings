// Adapted from environment evidence v0.1.0's persistent-profile harness.
// All inputs are fictional. No existing user profile, authentication or cloud DB.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web');
const out = process.env.SENLINGS_EVIDENCE && path.resolve(process.env.SENLINGS_EVIDENCE);
const fixtureFile = path.join(__dirname, 'fixtures/attendance-partial-v0.1.0.json');
const report = { started_at: new Date().toISOString(), timezone: 'Asia/Tokyo',
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  working_tree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  test_kind: 'headless Chromium; full persistent-context close and relaunch; fictional data only',
  outside_http_allowed: false, external_blocked: [], results: [] };
let context, origin, profiles, legacy;
const server = http.createServer(async (req, res) => {
  const f = path.resolve(web, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!f.startsWith(web + path.sep) || /^\/(api|master)(\/|$)/.test(req.url)) return res.writeHead(403).end();
  try {
    const b = await fs.readFile(f);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(b);
  } catch { res.writeHead(404).end(); }
});
async function close() { await context?.close(); context = null; }
async function open(profile) {
  context = await chromium.launchPersistentContext(path.join(profiles, profile), {
    executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'],
    viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo', serviceWorkers: 'block',
  });
  report.chromium = context.browser().version();
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(origin + '/')) return route.continue();
    report.external_blocked.push(new URL(url).origin); return route.abort();
  });
  const p = context.pages()[0] || await context.newPage(); p.setDefaultTimeout(8000);
  p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(origin); await p.waitForFunction(() => typeof document.getElementById('btn-receive-property')?.onclick === 'function'); return p;
}
const raw = p => p.evaluate(() => localStorage.getItem('senlings_v0'));
const data = async p => JSON.parse(await raw(p));
async function record(name, value) { if (out) await fs.writeFile(path.join(out, name + '.json'), JSON.stringify(value, null, 2)); }
async function seed(profile, value) {
  const p = await open(profile);
  await p.evaluate(value => { localStorage.setItem('senlings_v0', JSON.stringify(value)); localStorage.setItem('unrelated-key', 'KEEP'); }, value);
  await close(); // No init script: only the persisted bytes survive the next launch.
  return open(profile);
}
async function restart(profile, p) {
  const before = await raw(p); await close(); const next = await open(profile);
  assert.equal(await raw(next), before);
  assert.equal(await next.evaluate(() => localStorage.getItem('unrelated-key')), 'KEEP');
  return next;
}
async function goReturn(p) {
  await p.locator('.site-card-resume-btn').click(); await p.locator('#btn-return').click();
}
async function send(p) {
  await p.locator('#btn-return-send').click(); await p.locator('#return-complete-modal:not([hidden])').waitFor();
  assert.deepEqual(p.errors, []);
}
async function exported(p) {
  await p.locator('[data-tab="home"]').click();
  const promise = p.waitForEvent('download'); await p.locator('#btn-export-json-shimai').click();
  const download = await promise; return JSON.parse(await fs.readFile(await download.path(), 'utf8'));
}
async function fault(p, mode) {
  await p.evaluate(mode => {
    const set = Storage.prototype.setItem, get = Storage.prototype.getItem;
    window.testWrites = 0; let reads = 0;
    Storage.prototype.setItem = function(k, v) {
      if (k === 'senlings_v0' && ++window.testWrites === (mode === 'second-write' ? 2 : 1) && mode !== 'read') throw Error('injected quota');
      return set.call(this, k, v);
    };
    Storage.prototype.getItem = function(k) {
      if (k === 'senlings_v0' && ++reads === 3 && mode === 'read') throw Error('injected late read failure');
      return get.call(this, k);
    };
  }, mode);
}
const unchangedExceptEntry = (actual, before) => assert.deepEqual(actual, { ...before, current_session: null });
function richLegacy() {
  const d = structuredClone(legacy);
  d.contacts = [{ contact_id: 'fake-contact', name: '隔離連絡先', extra: { keep: true } }];
  d.projects.push({ project_id: 'other', project_slug: '別の架空現場', site_info: { raw: '別原文\n保持' }, archive: true });
  d.work_sessions.push({ id: 'unrelated', project_id: 'other', check_in_at: 1000, check_out_at: 2000, break_minutes: 0, extra: 'keep' });
  d.expenses = [{ id: 'fake-expense', project_id: 'other', expense_date: '2026-10-20', amount: 100, extra: 'keep' }];
  d.photos = [{ id: 'fake-photo', project_id: 'other', filename: 'fake.jpg', extra: 'keep' }];
  d.invoice_snapshots = [{ snapshot_id: 'frozen', project_id: 'other', source_hash: 'unchanged', extra: { keep: true } }];
  d.event_log = [{ type: 'KEEP', extra: true }]; d.future = { keep: ['unknown', 42] };
  d.work_sessions[0].extra = { original: true };
  return d;
}
async function run(name, fn) {
  try { const details = await fn(); report.results.push({ name, pass: true, ...details }); console.log('PASS', name); }
  catch (e) { report.results.push({ name, pass: false, error: e.stack }); throw e; }
  finally { await close(); }
}
(async () => {
  if (out) await fs.mkdir(out, { recursive: true });
  profiles = await fs.mkdtemp(path.join(os.tmpdir(), 'senlings-restart-'));
  const fixtureBytes = await fs.readFile(fixtureFile); legacy = JSON.parse(fixtureBytes);
  report.legacy_fixture_sha256 = crypto.createHash('sha256').update(fixtureBytes).digest('hex');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;

  await run('v0.1.0 exact partial-save evidence > restart > retry > restart > JSON readback', async () => {
    let p = await seed('legacy-exact', legacy); await goReturn(p); await send(p);
    const saved = await data(p); unchangedExceptEntry(saved, legacy);
    p = await restart('legacy-exact', p); assert.deepEqual(await exported(p), saved);
    await record('legacy-exact-after', saved); return { attendance_before: 1, attendance_after: 1, all_other_data_preserved: true };
  });
  await run('rich legacy recovery write fails > unchanged bytes > restart > retry preserves all collections', async () => {
    const before = richLegacy(); let p = await seed('legacy-rich', before); await goReturn(p);
    const bytes = await raw(p); await fault(p, 'write'); await p.locator('#btn-return-send').click();
    await p.locator('#storage-error[open]').waitFor(); assert.equal(await raw(p), bytes);
    assert.equal(await p.locator('#return-complete-modal:not([hidden])').count(), 0);
    p = await restart('legacy-rich', p); await goReturn(p); await send(p);
    const saved = await data(p); unchangedExceptEntry(saved, before);
    p = await restart('legacy-rich', p); assert.deepEqual(await exported(p), saved);
    await record('rich-legacy-before', before); await record('rich-legacy-after', saved);
    return { attendance_before: 2, attendance_after: 2, all_other_data_preserved: true };
  });
  await run('normal register > raw text > checkin > restart > single-write checkout > invoice > restart > JSON', async () => {
    const before = richLegacy(); before.current_session = null;
    let p = await seed('normal', before);
    await p.locator('#btn-add-site').click(); await p.locator('#add-site-name').fill('修正版・架空現場C');
    await p.locator('#add-site-raw').fill('架空の原文\n二行目も保持'); await p.locator('#btn-add-site-save').click();
    await p.locator('.site-card').filter({ hasText: '修正版・架空現場C' }).click();
    await p.getByText('届いた連絡', { exact: true }).click();
    assert.equal(await p.locator('.handover-text').innerText(), '架空の原文\n二行目も保持');
    await p.locator('#btn-checkin').click(); const entered = await data(p);
    p = await restart('normal', p); await goReturn(p); await fault(p, 'second-write'); await send(p);
    assert.equal(await p.evaluate(() => testWrites), 1); // The old second-write fault is no longer reached.
    const completed = await data(p); assert.equal(completed.work_sessions.length, before.work_sessions.length + 1);
    assert.equal(completed.current_session, null);
    const newSession = completed.work_sessions.at(-1);
    assert.equal(newSession.check_in_at, entered.current_session.check_in_at);
    assert.equal(newSession.project_id, entered.current_session.project_id);
    assert.deepEqual(completed, { ...entered, current_session: null, work_sessions: [...before.work_sessions, newSession] });
    // Repeat the same submission event while still on the return screen: no extra write.
    await p.locator('#btn-return-send').dispatchEvent('click');
    assert.equal(await p.evaluate(() => testWrites), 1); assert.deepEqual(await data(p), completed);
    // Reset only test instrumentation before unrelated invoice writes.
    p = await restart('normal', p); await p.locator('[data-tab="home"]').click();
    await p.locator('#btn-shimai-invoice').click(); await p.locator('#btn-invoice-skip-expense').click();
    await p.locator('.invoice-card-title').waitFor(); const saved = await data(p);
    assert.equal(saved.invoice_snapshots.length, before.invoice_snapshots.length + 1);
    const invoice = saved.invoice_snapshots.at(-1);
    assert.equal(invoice.project_id, newSession.project_id); assert.equal(invoice.total_work_days, 1);
    assert.equal(invoice.daily_breakdown.length, 1); assert.equal(invoice.daily_breakdown[0].session_count, 1);
    assert.deepEqual({ ...saved, invoice_snapshots: before.invoice_snapshots, event_log: before.event_log }, completed);
    assert.deepEqual(saved.invoice_snapshots.slice(0, -1), before.invoice_snapshots);
    assert.deepEqual(saved.event_log.slice(0, before.event_log.length), before.event_log);
    p = await restart('normal', p); assert.deepEqual(await exported(p), saved);
    await record('normal-before', before); await record('normal-readback', saved);
    return { new_attendance: 1, new_invoice: 1, invoice_attendance_count: 1, checkout_write_count: 1, all_other_data_preserved: true };
  });
  for (const mode of ['write', 'read']) await run(`normal checkout ${mode} failure > restart > retry without duplicate`, async () => {
    const before = richLegacy(); before.work_sessions.shift();
    let p = await seed('normal-fail-' + mode, before); await goReturn(p); const bytes = await raw(p);
    await fault(p, mode); await p.locator('#btn-return-send').click(); await p.locator('#storage-error[open]').waitFor();
    assert.equal(await raw(p), bytes); assert.equal(await p.locator('#return-complete-modal:not([hidden])').count(), 0);
    p = await restart('normal-fail-' + mode, p); await goReturn(p); await send(p); const saved = await data(p);
    assert.equal(saved.work_sessions.length, before.work_sessions.length + 1);
    assert.deepEqual(saved, { ...before, current_session: null, work_sessions: [...before.work_sessions, saved.work_sessions.at(-1)] });
    assert.equal(saved.work_sessions.at(-1).check_in_at, before.current_session.check_in_at);
    p = await restart('normal-fail-' + mode, p); assert.deepEqual(await exported(p), saved);
    await record('normal-fail-' + mode + '-after', saved); return { no_partial_write: true, new_attendance: 1, all_other_data_preserved: true };
  });
  await run('already duplicated legacy input stops unchanged across restart; no success', async () => {
    const before = richLegacy(); before.work_sessions.push({ ...before.work_sessions[0], id: 'preexisting-duplicate' });
    let p = await seed('ambiguous', before); const bytes = await raw(p);
    for (let attempt = 0; attempt < 2; attempt++) {
      await goReturn(p); await p.locator('#btn-return-send').click(); await p.locator('#storage-error[open]').waitFor();
      assert.match(await p.locator('#storage-error').innerText(), /勤怠が複数/);
      assert.equal(await p.locator('#return-complete-modal:not([hidden])').count(), 0); assert.equal(await raw(p), bytes);
      p = await restart('ambiguous', p);
    }
    await record('ambiguous-unchanged', before); return { blocked: true, unchanged: true, no_automatic_history_repair: true };
  });
  await run('stale return screen cannot clear a replacement active entry', async () => {
    let p = await seed('stale', legacy); await goReturn(p);
    await p.evaluate(() => { const d = JSON.parse(localStorage.getItem('senlings_v0')); d.current_session.check_in_at += 1; localStorage.setItem('senlings_v0', JSON.stringify(d)); });
    const bytes = await raw(p); await p.locator('#btn-return-send').click(); await p.locator('#storage-error[open]').waitFor();
    assert.match(await p.locator('#storage-error').innerText(), /画面の内容と変わっています/);
    assert.equal(await raw(p), bytes); assert.equal(await p.locator('#return-complete-modal:not([hidden])').count(), 0);
    return { blocked: true, replacement_entry_preserved: true };
  });
})().catch(e => { report.harness_error = e.stack; console.error(e); process.exitCode = 1; }).finally(async () => {
  await close(); server.close(); if (profiles) await fs.rm(profiles, { recursive: true, force: true });
  report.external_blocked = [...new Set(report.external_blocked)]; report.finished_at = new Date().toISOString();
  report.pass = report.results.length === 7 && report.results.every(r => r.pass) && !report.harness_error;
  if (!report.pass) process.exitCode = 1;
  await record('attendance-restart-result', report);
  console.log(`Restart acceptance: ${report.results.filter(r => r.pass).length}/7, pass=${report.pass}`);
});
