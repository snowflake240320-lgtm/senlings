// Fictional data only. A real persistent Chromium profile is closed and reopened.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const web = path.resolve(__dirname, '../web'), root = path.resolve(__dirname, '..');
const out = process.env.SENLINGS_EVIDENCE;
const report = { started_at: new Date().toISOString(), source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  working_tree: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(), external_allowed: false, real_device: false, results: [] };
const server = http.createServer(async (req, res) => {
  const file = path.resolve(web, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(web + path.sep) || /^\/(api|master)(\/|$)/.test(req.url)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html;charset=utf-8' : 'application/octet-stream'); res.end(await fs.readFile(file)); }
  catch { res.writeHead(404).end(); }
});
const fixture = { projects: [{ project_id: 'old', project_slug: '隔離試験・既存現場', address: '架空住所', site_info: { raw: 'PRIVATE原文', contact: '架空担当者', contact_phone: '000-0000-0000' }, future: 'KEEP' }],
  contacts: [{ contact_id: 'c', name: '架空' }], work_sessions: [], photos: [], invoice_snapshots: [{ snapshot_id: 'frozen', project_id: 'old', source_hash: 'KEEP' }],
  expenses: [], event_log: [{ type: 'KEEP' }], future: { preserved: true } };
const packet = { format: 'senlings.project-handoff', schema_version: 1, source_project_id: 'external-test', revision: 1,
  project: { name: '隔離試験・受取現場', address: '架空住所2', contact: '架空の担当者', contact_phone: '000-0000-0000', raw: '届いた連絡\n<script>window.injected=true</script>' } };
const localName = '自分の呼び名・受取現場'; // 表札は職人のもの:最初の受取で決め、送り手の新版でも変わらない
let context, origin, profile, page;
const click = selector => page.locator(selector).click();
const raw = () => page.evaluate(() => localStorage.getItem('senlings_v0'));
const saved = async () => JSON.parse(await raw());
async function run(name, fn) { await fn(); report.results.push({ name, pass: true }); console.log('PASS', name); }
async function open() {
  context = await chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox'], viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Tokyo', serviceWorkers: 'block' });
  report.chromium = context.browser().version();
  await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  page = context.pages()[0] || await context.newPage(); page.setDefaultTimeout(8000); page.errors = []; page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(origin); await page.waitForFunction(() => typeof document.getElementById('btn-receive-property')?.onclick === 'function');
}
async function restart() { const before = await raw(); assert.deepEqual(page.errors, []); await context.close(); await open(); assert.equal(await raw(), before); }
async function closeDialog() { await click('#local-dialog .local-close'); }
async function receive(contents) { await click('#btn-receive-property'); await page.locator('#handoff-input').fill(contents); await click('#handoff-inspect'); }
async function downloads(selector) { const wait = page.waitForEvent('download'); await click(selector); return fs.readFile(await (await wait).path(), 'utf8'); }
async function screenshot(name) { if (out) await page.screenshot({ path: path.join(out, name + '.png'), animations: 'disabled' }); }
async function inject() {
  await page.evaluate(() => { const original = Storage.prototype.setItem; window.restoreWrites = () => { Storage.prototype.setItem = original; }; Storage.prototype.setItem = function(key, value) { if (key === 'senlings_v0') throw new DOMException('test quota', 'QuotaExceededError'); return original.call(this, key, value); }; });
}
async function retry() { await page.evaluate(() => window.restoreWrites()); await click('#storage-error button'); }
async function preparePhoto() {
  const data = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 20; c.height = 20; const ctx = c.getContext('2d'); ctx.fillStyle = '#c5a059'; ctx.fillRect(0,0,20,20); return c.toDataURL('image/png').split(',')[1]; });
  await page.locator('#private-photo').setInputFiles({ name: 'fictional.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') });
  await page.waitForFunction(() => !document.getElementById('photo-save').disabled);
}
(async () => {
  if (out) await fs.mkdir(out, { recursive: true }); profile = await fs.mkdtemp(path.join(os.tmpdir(), 'senlings-local-'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`;
  await open(); await page.evaluate(data => { localStorage.setItem('senlings_v0', JSON.stringify(data)); localStorage.setItem('unrelated', 'KEEP'); }, fixture); await page.reload();
  await run('outgoing property preview is opt-in and excludes private content', async () => {
    await click('.site-card'); await click('#btn-give-property'); await click('#handoff-review');
    const bare = JSON.parse(await downloads('#handoff-download')); assert.deepEqual(bare.project, { name: fixture.projects[0].project_slug });
    await page.locator('input[type=checkbox][value=address]').check(); assert.equal(await page.locator('#handoff-download').isDisabled(), true);
    await click('#handoff-review'); const selected = JSON.parse(await downloads('#handoff-download'));
    assert.deepEqual(selected.project, { name: fixture.projects[0].project_slug, address: '架空住所' }); assert.ok(!JSON.stringify(selected).includes('PRIVATE'));
    await screenshot('property-export'); await closeDialog(); await click('#btn-back-handover');
  });
  await run('receive preview is inert; quota failure keeps original bytes; retry saves project and original once', async () => {
    await receive(JSON.stringify(packet)); assert.equal((await saved()).projects.length, 1); assert.equal(await page.evaluate(() => !!window.injected), false);
    assert.equal(await page.locator('#handoff-slug').inputValue(), packet.project.name); await page.locator('#handoff-slug').fill(localName);
    const preview = await page.locator('#handoff-preview').innerText(); // RUNBOOK操作2:現場名・住所・担当者・原文を目で確認できる
    for (const expected of ['住所', packet.project.address, '連絡先・担当者', packet.project.contact, '届いた連絡の原文', '届いた連絡']) assert.ok(preview.includes(expected), expected);
    const before = await raw(); await inject(); await click('#handoff-accept'); await page.locator('#storage-error[open]').waitFor(); assert.equal(await raw(), before);
    await retry(); await click('#handoff-accept'); assert.equal((await saved()).projects.length, 2); assert.equal((await saved()).handoff_receipts.length, 1);
    const received = (await saved()).projects[1]; assert.equal(received.project_slug, localName); assert.equal(received.handoff_source.name, packet.project.name);
    await screenshot('property-receive'); await closeDialog();
  });
  await run('same received file after full restart adds no duplicate; changed same-version content is refused', async () => {
    await restart(); const before = await raw(); await receive(JSON.stringify(packet)); await click('#handoff-accept'); assert.equal(await raw(), before); await closeDialog();
    await receive(JSON.stringify({ ...packet, project: { ...packet.project, name: '内容が違う' } })); assert.equal(await page.locator('#handoff-accept').isDisabled(), true);
    assert.match(await page.locator('#local-dialog [role=status]').innerText(), /同じ物件ID・版/); assert.equal(await raw(), before); await closeDialog();
  });
  await run('new revision keeps the local name, updates only sent fields, keeps the earlier original text', async () => {
    const revised = { ...packet, revision: 2, project: { name: '送り手の新しい現場名', address: '架空住所3' } };
    await receive(JSON.stringify(revised)); assert.equal(await page.locator('#handoff-slug').count(), 0);
    const text = await page.locator('#handoff-preview').innerText(); assert.match(text, /現場名はそのまま：自分の呼び名・受取現場/); assert.match(text, /送り手の現場名：送り手の新しい現場名/);
    assert.equal(await page.locator('#handoff-accept').innerText(), '確認してこの版を反映する'); await click('#handoff-accept');
    const data = await saved(); const received = data.projects[1];
    assert.equal(data.projects.length, 2); assert.equal(received.project_slug, localName); assert.equal(received.address, '架空住所3');
    assert.equal(received.site_info.raw, packet.project.raw); assert.equal(received.site_info.contact, packet.project.contact);
    assert.deepEqual(received.handoff_source, { source_project_id: packet.source_project_id, revision: 2, name: '送り手の新しい現場名' });
    assert.equal(data.handoff_receipts.length, 2); assert.equal(data.handoff_receipts[0].packet.project.name, packet.project.name);
    await screenshot('property-revision'); await closeDialog();
  });
  await run('received project checks in and a private memo survives failed save and retry', async () => {
    await page.locator('.site-card').filter({ hasText: '受取現場' }).click(); await click('#btn-checkin'); await click('#btn-memo');
    await page.locator('#private-memo').fill('自分の工夫。採点しない。'); const before = await raw(); await inject(); await click('#memo-save'); await page.locator('#storage-error[open]').waitFor(); assert.equal(await raw(), before);
    await retry(); await click('#memo-save'); assert.equal((await saved()).local_records.length, 1); await closeDialog();
  });
  await run('photo previews before saving, quota failure leaves no metadata, retry stores a reduced image', async () => {
    await click('#btn-photo'); await preparePhoto(); await page.locator('#photo-caption').fill('架空の工夫写真'); assert.equal((await saved()).photos.length, 0);
    const before = await raw(); await inject(); await click('#photo-save'); await page.locator('#storage-error[open]').waitFor(); assert.equal(await raw(), before);
    await retry(); await click('#photo-save'); const photo = (await saved()).photos[0]; assert.equal(photo.storage_kind, 'local_reduced'); assert.match(photo.thumbnail, /^data:image\/jpeg;base64,/);
    await closeDialog();
  });
  await run('SOS failed save cannot claim delivery; successful save and copy remain unsent', async () => {
    await click('#btn-sos'); await click('.sos-option[data-key=danger]'); await page.locator('#sos-memo').fill('架空の足場の確認');
    const before = await raw(); await inject(); await click('#btn-sos-send'); await page.locator('#storage-error[open]').waitFor(); assert.equal(await raw(), before); assert.equal(await page.locator('#sos-complete-modal').isHidden(), true);
    await retry(); await click('#btn-sos-send'); await page.locator('#sos-complete-modal:not([hidden])').waitFor();
    assert.match(await page.locator('#sos-complete-modal').innerText(), /まだ誰にも送っていません/); assert.match(await page.locator('#btn-sos-call').innerText(), /担当者へ電話する：00000000000[\s\S]*危ないときは、待たずに/); // 番号がある現場だけ電話ボタン。発信はしない assert.doesNotMatch(await page.locator('#sos-complete-modal').innerText(), /伝わっています/);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copied = text; } }, configurable: true }));
    await click('#btn-sos-copy'); assert.match(await page.locator('#sos-delivery-status').innerText(), /到達は未確認/);
    assert.equal((await saved()).local_records.find(r => r.kind === 'sos').delivery_status, 'not_sent');
    await screenshot('sos-unsent'); await click('#btn-sos-wait');
  });
  await run('full restart retains photos/memo/SOS; return via Shimai uses original entry and saves personal note once', async () => {
    const entry = (await saved()).current_session; await restart(); await click('.site-card-resume-btn'); await click('[data-tab=shimai]'); await click('#btn-shimai-confirm-return');
    await page.locator('#return-memo').fill('また使いたい工夫'); await click('#btn-return-send'); await page.locator('#return-complete-modal:not([hidden])').waitFor();
    const data = await saved(); assert.equal(data.work_sessions.length, 1); assert.equal(data.work_sessions[0].check_in_at, entry.check_in_at); assert.equal(data.work_sessions[0].personal_note.text, 'また使いたい工夫'); assert.equal(data.current_session, null);
    await restart(); assert.equal((await saved()).work_sessions.length, 1); await click('[data-tab=shimai]'); await click('#btn-review-records');
    assert.equal(await page.locator('.local-record').count(), 4); assert.equal(await page.locator('.local-record img').count(), 1); await screenshot('personal-records'); await closeDialog();
  });
  await run('project CSV and selected record export work; full JSON includes originals, private notes and reduced photos', async () => {
    await click('#btn-export-csv-project-shimai'); const localId = (await saved()).handoff_receipts[0].project_id;
    await page.locator('#export-project').selectOption(localId); assert.match(await downloads('#btn-project-csv'), /労務費/); await click('#project-export-dialog form button');
    await click('#btn-review-records'); const download = page.waitForEvent('download'); await page.locator('.local-record').filter({ hasText: 'また使いたい工夫' }).locator('button').click();
    assert.match(await fs.readFile(await (await download).path(), 'utf8'), /また使いたい工夫/); await closeDialog();
    const data = JSON.parse(await downloads('#btn-export-json-shimai')); assert.equal(data.local_records.length, 2); assert.equal(data.photos.length, 1); assert.equal(data.handoff_receipts.length, 2);
    for (const key of ['contacts', 'invoice_snapshots', 'expenses', 'future']) assert.deepEqual(data[key], fixture[key]);
    assert.deepEqual(data.projects[0], fixture.projects[0]); assert.equal(await page.evaluate(() => localStorage.getItem('unrelated')), 'KEEP');
  });
  await run('settings failed save keeps exact bytes, successful save survives restart and JSON export', async () => {
    await click('#btn-shimai-settings'); await page.locator('#setting-user_name').fill('架空の職人'); const before = await raw();
    await inject(); await click('#settings-save'); await page.locator('#storage-error[open]').waitFor(); assert.equal(await raw(), before);
    await retry(); await click('#settings-save'); await closeDialog(); await restart(); await click('[data-tab=shimai]'); await click('#btn-shimai-settings');
    assert.equal(await page.locator('#setting-user_name').inputValue(), '架空の職人'); await closeDialog();
    assert.equal(JSON.parse(await downloads('#btn-export-json-shimai')).settings.senlings_user_name, '架空の職人');
  });
  await run('320px and 390px screens and receive dialog fit without horizontal overflow', async () => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 }); await click('[data-tab=genba]');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await click('#btn-receive-property'); assert.ok(await page.locator('#local-dialog').evaluate(el => el.scrollWidth <= el.clientWidth)); await closeDialog();
    }
    await screenshot('site-top'); assert.deepEqual(page.errors, []);
  });
  report.passed = report.results.length; report.completed_at = new Date().toISOString();
  if (out) await fs.writeFile(path.join(out, 'local-features-readback.json'), JSON.stringify(await saved(), null, 2));
  console.log(`Local feature browser groups passed: ${report.passed}`);
})().catch(error => { report.error = String(error.stack); console.error(error); process.exitCode = 1; }).finally(async () => {
  if (out) await fs.writeFile(path.join(out, 'local-features-result.json'), JSON.stringify(report, null, 2));
  await context?.close(); server.close(); if (profile) await fs.rm(profile, { recursive: true, force: true });
});
