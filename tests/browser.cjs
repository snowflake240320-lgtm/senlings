// Run with the existing Playwright installation; no production origin or database is used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const web = path.resolve(__dirname, '../web');
const fixture = () => ({ projects: [{ project_id: 'p', project_slug: 'TEST', future: 'keep' }],
  work_sessions: [{ id: 'w', project_id: 'p', check_in_at: Date.now() - 3600000, check_out_at: Date.now(), break_minutes: 0 }],
  expenses: [], future: { keep: true } });
// 今日の現場が置いてあって、もう終業を過ぎている日(残業おつかれさまが出る)
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const endedTeiji = (projectId = 'p') => { const now = Date.now(); return { id: `teiji:${ymd(new Date())}`, kind: 'teiji', date: ymd(new Date()), project_id: projectId,
  check_in_at: now - 10 * 3600000, check_out_at: now - 3600000 + 60000, break_minutes: 60, overtime_minutes: 0, placed_at: now - 11 * 3600000 }; };
const server = http.createServer(async (req, res) => {
  const p = req.url.split('?')[0]; // 本番(Vercel)と同じく、/?… も /irai/ も index.html
  const file = path.resolve(web, '.' + (p.endsWith('/') ? `${p}index.html` : p));
  if (!file.startsWith(web + path.sep)) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream'); // 本番と同じく、見た目(CSS)と写真も正しく渡す
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
let browser, origin;
let passed = 0;
async function run(name, fn) { if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return; box.docs.clear(); box.calls.length = 0; box.down = false; box.readOnly = false; await fn(); console.log('PASS', name); passed++; }
// 郵便受けの代役(Firestore REST の形だけ)。ブラウザとホーム画面の Senlings(別の context)が、同じ郵便受けを見る
const box = { docs: new Map(), calls: [], n: 0, down: false, readOnly: false };
function fakeFirestore(request) {
  const u = new URL(request.url()); const method = request.method(); const path = u.pathname.split('/documents/')[1]; box.calls.push(`${method} ${path}`);
  const json = (status, obj) => ({ status, contentType: 'application/json', body: obj === undefined ? '' : JSON.stringify(obj) });
  if (box.down || (box.readOnly && method !== 'GET')) return json(503, { error: { status: 'UNAVAILABLE' } });
  if (u.searchParams.get('key') !== 'AIzaSyBNaj9bllnBSjlnL63smknkSK7T8SNnWZo') return json(403, { error: 'key' });
  const body = request.postData() ? JSON.parse(request.postData()) : null;
  if (method === 'POST') { const id = `it${++box.n}`; box.docs.set(`${path}/${id}`, body.fields); return json(200, { name: `projects/p/databases/(default)/documents/${path}/${id}`, fields: body.fields }); }
  if (method === 'GET') {
    if (box.docs.has(path)) return json(200, { name: path, fields: box.docs.get(path) });
    const list = [...box.docs].filter(([k]) => k.startsWith(`${path}/`) && !k.slice(path.length + 1).includes('/')).map(([k, f]) => ({ name: `projects/p/databases/(default)/documents/${k}`, fields: f }));
    return list.length ? json(200, { documents: list }) : path.includes('/items') ? json(200, {}) : json(404, { error: 'not found' });
  }
  if (method === 'DELETE') { box.docs.delete(path); return json(200, {}); }
  if (method === 'PATCH') { box.docs.set(path, { ...(box.docs.get(path) ?? {}), ...body.fields }); return json(200, { fields: body.fields }); }
  return json(405, {});
}
const boxItems = () => [...box.docs.keys()].filter(k => k.includes('/items/'));
async function setup(raw = JSON.stringify(fixture()), { old = false, readError = false, realFirebase = false, ua = undefined, standalone = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...(ua ? { userAgent: ua } : {}) });
  if (standalone) await context.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (old && !realFirebase && url === origin + '/src/pwa/firebase.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `export async function syncProjectsFromFirestore(){return {added:0}}; export async function saveProjectToFirestore(){}; export async function pushAllProjectsToFirestore(){return {count:0}};` });
    }
    if (url.startsWith(origin + '/') || (realFirebase && url.startsWith('https://www.gstatic.com/firebasejs/'))) return route.continue();
    if (!old && url.startsWith('https://firestore.googleapis.com/v1/projects/senlings-7e838/databases/(default)/documents/boxes/')) return route.fulfill(fakeFirestore(route.request()));
    return route.abort(); // In particular, Firestore/Auth/API and mail are never contacted.
  });
  await context.addInitScript(({raw, readError}) => {
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    if (raw !== null) set.call(localStorage, 'senlings_v0', raw);
    window.fault = { readError, writeError: false, writes: 0, reads: 0, failWrite: 0, failRead: 0 };
    window.rawStored = () => get.call(localStorage, 'senlings_v0');
    window.replaceStored = raw => set.call(localStorage, 'senlings_v0', raw);
    Storage.prototype.getItem = function(key) {
      if (key === 'senlings_v0') {
        fault.reads++;
        if (fault.readError || fault.reads === fault.failRead) throw Error('test read denied');
      }
      return get.call(this, key);
    };
    Storage.prototype.setItem = function(key, value) {
      if (key === 'senlings_v0') {
        fault.writes++;
        if (fault.writeError || fault.writes === fault.failWrite) throw Error('test quota');
      }
      return set.call(this, key, value);
    };
  }, { raw, readError });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.errors = [];
  if (realFirebase) page.on('requestfailed', req => console.log('CDN probe request failure:', new URL(req.url()).hostname, req.failure()?.errorText));
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(origin + (old ? '/index_old.html' : '/'));
  return { page, context };
}
async function click(page, selector) { await page.locator(selector).click(); }
async function ready(page) { await page.locator('.site-card').waitFor(); }
// 請求書のたたき台・持ち出しは▲ホームへ載せ替えた(維新)
async function shimai(page) { await click(page, '[data-tab="home"]'); }
// 出勤は押さない。今日の現場を選ぶと、定時の一日が置かれて現場の上へ(2026-10-25)
async function working(page) { await click(page, '.site-card'); await click(page, '#btn-today'); await page.locator('#screen-working.active').waitFor(); }
// 更新の前に入場していた途中の記録(入った/出た)
const legacyEntry = () => { const d = fixture(); d.current_session = { project_id: 'p', check_in_at: Date.now() - 1000 }; return d; };
async function legacyWorking(page) { await click(page, '.site-card-resume-btn'); await page.locator('#screen-working.active').waitFor(); }
async function stats(page) { return page.evaluate(() => ({ raw: rawStored(), writes: fault.writes })); }
async function inject(page, mode) {
  await page.evaluate(mode => {
    fault.writes = 0;
    if (mode === 'corrupt') replaceStored('{broken');
    if (mode === 'readError') fault.readError = true;
    if (mode === 'writeError') fault.writeError = true;
  }, mode);
  return stats(page);
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  for (const old of [false, true]) {
    for (const raw of ['{broken', 'null', '{"projects":null}', '{"current_session":[]}', 'getError']) {
      await run(`${old ? 'old' : 'new'} startup unreadable ${raw}`, async () => {
        const {page,context} = await setup(raw === 'getError' ? JSON.stringify(fixture()) : raw, {old, readError: raw === 'getError'});
        await page.locator('#storage-error[open]').waitFor();
        assert.match(await page.locator('#storage-error').innerText(), /読み取れません/);
        assert.equal((await stats(page)).writes, 0);
        assert.equal(await page.locator('.site-empty').count(), 0);
        if (!old && raw === '{broken' && process.env.EVIDENCE_DIR) await page.screenshot({path: path.join(process.env.EVIDENCE_DIR,'senlings-read-error.png')});
        await context.close();
      });
    }
  }
  const actions = {
    add: { prepare: async p => { await click(p,'#btn-add-site'); await p.locator('#add-site-name').fill('TEST NEW'); }, selector: '#btn-add-site-save', success: '#add-site-modal[hidden]' },
    start: { prepare: p => click(p,'.site-card'), selector: '#btn-today', success: '#screen-working.active' },
    cancel: { legacy: true, prepare: p => click(p,'.site-card-cancel-btn'), selector: '.site-card-cancel-btn', success: '.site-card:not(.site-card-today)' },
    return: { legacy: true, prepare: async p => { await legacyWorking(p); await click(p,'#btn-return'); }, selector: '#btn-return-send', success: '#return-complete-modal:not([hidden])' },
    returnNote: { prepare: async p => { await working(p); await click(p,'#btn-return'); await p.locator('#return-memo').fill('架空の一言'); }, selector: '#btn-return-send', success: '#return-complete-modal:not([hidden])' },
    zangyo: { teijiEnded: true, prepare: p => p.locator('#working-zangyo:not([hidden])').waitFor(), selector: '#btn-zangyo', success: '.zangyo-said:has-text("おつかれさま")' },
    junbi: { prepare: shimai, selector: '#junbi-project', select: 'p', success: '#junbi-now:not(:empty)' },
    invoice: { prepare: shimai, selector: '#btn-shimai-invoice', success: '.invoice-card-title' },
    skip: { prepare: async p => { await shimai(p); await click(p,'#btn-shimai-invoice'); }, selector: '#btn-invoice-skip-expense', success: '.invoice-card-title' },
    json: { prepare: async p => { await shimai(p); await click(p,'#btn-settings'); }, selector: '#btn-export-json-shimai' },
    csv: { prepare: shimai, selector: '#btn-export-csv-monthly-shimai' },
  };
  for (const [name, action] of Object.entries(actions)) {
    for (const mode of ['corrupt', 'readError', 'writeError']) {
      if (mode === 'writeError' && ['json','csv'].includes(name)) continue;
      await run(`new UI ${name} ${mode}: no false success`, async () => {
        const data = action.legacy ? legacyEntry() : fixture();
        if (action.teijiEnded) data.work_sessions.push(endedTeiji());
        if (name === 'invoice') data.expenses = [{ project_id: 'p', expense_date: new Date().toISOString().slice(0,10), amount: 10 }];
        const {page,context} = await setup(JSON.stringify(data));
        await (action.teijiEnded ? page.locator('#screen-working.active').waitFor() : action.legacy ? page.locator('.site-card-pending').waitFor() : ready(page)); await action.prepare(page);
        let downloads = 0; page.on('download', () => downloads++);
        const before = await inject(page,mode);
        if (action.select) await page.locator(action.selector).selectOption(action.select); else await click(page,action.selector);
        await page.locator('#storage-error[open]').waitFor();
        const after = await stats(page);
        assert.equal(after.raw,before.raw);
        assert.equal(after.writes, mode === 'writeError' ? 1 : 0);
        if (action.success) assert.equal(await page.locator(action.success).count(),0);
        assert.equal(downloads,0);
        assert.deepEqual(page.errors,[]);
        await context.close();
      });
    }
  }
  await run('new UI normal first use, Return, skip, JSON/CSV and unknown fields', async () => {
    const {page,context} = await setup(null);
    await page.locator('.site-empty').waitFor(); assert.equal((await stats(page)).writes,0);
    await click(page,'#btn-add-site'); await page.locator('#add-site-name').fill('TEST'); await click(page,'#btn-add-site-save');
    await page.evaluate(() => { const d=JSON.parse(rawStored()); d.future={keep:true};d.projects[0].future='keep';replaceStored(JSON.stringify(d)); });
    await working(page); await click(page,'#btn-return'); await click(page,'#btn-return-send');
    await page.locator('#return-complete-modal:not([hidden])').waitFor(); await click(page,'#btn-return-to-shimai');
    await click(page,'[data-tab="home"]'); await click(page,'#btn-shimai-invoice'); await click(page,'#btn-invoice-skip-expense');
    await page.locator('.invoice-card-title').waitFor();
    for (const selector of ['#btn-export-csv-monthly-shimai','#btn-export-json-shimai']) {
      if (selector.includes('json')) await click(page,'#btn-settings'); // 全部の持ち出しは設定の中
      const download=page.waitForEvent('download'); await click(page,selector); const d=await download;
      const content=await fs.readFile(await d.path(),'utf8');
      assert.ok(content.includes(selector.includes('json') ? '"future"' : '労務費'));
    }
    const saved=JSON.parse((await stats(page)).raw);
    assert.equal(saved.current_session ?? null,null);assert.equal(saved.work_sessions.length,1);assert.equal(saved.invoice_snapshots.length,1);
    assert.equal(saved.work_sessions[0].kind,'teiji');assert.equal(saved.invoice_snapshots[0].total_work_days,1);
    assert.deepEqual(saved.future,{keep:true});assert.equal(saved.projects[0].future,'keep');assert.deepEqual(page.errors,[]);
    await context.close();
  });
  await run('new UI explicit read retry makes no write', async () => {
    const {page,context}=await setup('{broken'); await page.locator('#storage-error[open]').waitFor();
    await click(page,'#storage-error button'); assert.equal((await stats(page)).writes,0);
    await page.evaluate(raw=>replaceStored(raw),JSON.stringify(fixture()));
    await click(page,'#storage-error button'); await ready(page);
    assert.equal(await page.locator('#storage-error[open]').count(),0); assert.equal((await stats(page)).writes,0);
    await context.close();
  });
  for (const faultType of ['write', 'read']) await run(`Return atomic ${faultType} failure: unchanged data, no completion, same-screen retry no duplicate`, async () => {
    const {page,context}=await setup(JSON.stringify(legacyEntry())); await page.locator('.site-card-pending').waitFor();await legacyWorking(page);await click(page,'#btn-return');
    const original=(await stats(page)).raw;
    // Reads: shared click guard, completion load, final storage save recheck.
    await page.evaluate(type=>{fault.writes=0;if(type==='write')fault.failWrite=1;else fault.failRead=fault.reads+3;},faultType);await click(page,'#btn-return-send');
    await page.locator('#storage-error[open]').waitFor();
    assert.equal(await page.locator('#return-complete-modal:not([hidden])').count(),0);
    assert.equal((await stats(page)).raw,original);
    assert.equal((await stats(page)).writes,faultType==='write'?1:0);
    await page.evaluate(()=>{fault.failWrite=0;fault.failRead=0;});await click(page,'#storage-error button');await click(page,'#btn-return-send');
    await page.locator('#return-complete-modal:not([hidden])').waitFor();
    const after=JSON.parse((await stats(page)).raw);assert.equal(after.work_sessions.length,2);assert.equal(after.current_session,null);
    await context.close();
  });
  await run('new UI unreadable at final prewrite recheck: zero writes', async()=>{
    const {page,context}=await setup();await ready(page);await click(page,'.site-card');
    const before=await stats(page);await page.evaluate(()=>{fault.failRead=fault.reads+4;});await click(page,'#btn-today');
    await page.locator('#storage-error[open]').waitFor();assert.deepEqual(await stats(page),before);
    assert.equal(await page.locator('#screen-working.active').count(),0);await context.close();
  });
  await run('new UI skip succeeds but snapshot write fails: no invoice success',async()=>{
    const {page,context}=await setup();await ready(page);await shimai(page);await click(page,'#btn-shimai-invoice');
    await page.evaluate(()=>{fault.writes=0;fault.failWrite=2;});await click(page,'#btn-invoice-skip-expense');
    await page.locator('#storage-error[open]').waitFor();
    const saved=JSON.parse((await stats(page)).raw);assert.equal(saved.event_log.at(-1).status,'skipped');assert.equal(saved.invoice_snapshots.length,0);
    assert.equal(await page.locator('.invoice-card-title').count(),0);await context.close();
  });
  // ── 維新の殻:●施設 → ■現場 → ◆仕舞 → ▲ホーム → 見積 ──
  await run('shell tabs: order, facility shown from the start, can be put away, no write on tab moves', async () => {
    const {page,context}=await setup();await ready(page);
    const visible=async()=>page.locator('.tab:visible .tab-label').allInnerTexts();
    assert.deepEqual(await visible(),['施設','現場','仕舞い','調査','ホーム']);
    const before=await stats(page);
    for (const [tab,screen] of [['shisetsu','#screen-shisetsu'],['shimai','#screen-shimai'],['home','#screen-home'],['mitsumori','#screen-mitsumori'],['genba','#screen-site-top']]) {
      await click(page,`[data-tab="${tab}"]`);await page.locator(`${screen}.active`).waitFor();
      assert.equal(await page.locator(`[data-tab="${tab}"].active`).count(),1);
    }
    assert.deepEqual(await stats(page),before);
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');assert.equal(await page.locator('#setting-show-shisetsu').isChecked(),true);
    await page.locator('#setting-show-shisetsu').uncheck();assert.deepEqual(await visible(),['現場','仕舞い','調査','ホーム']);
    await page.reload();await ready(page);
    assert.deepEqual(await visible(),['現場','仕舞い','調査','ホーム'],'putting it away is remembered');
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');await page.locator('#setting-show-shisetsu').check();
    assert.deepEqual(await visible(),['施設','現場','仕舞い','調査','ホーム']);
    await page.reload();await ready(page);assert.deepEqual(await visible(),['施設','現場','仕舞い','調査','ホーム']);
    assert.equal((await stats(page)).raw,before.raw);assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('shell: Shimai while working, back to the same working screen; no confirm modal', async () => {
    const {page,context}=await setup();await ready(page);await working(page);
    await click(page,'[data-tab="shimai"]');await page.locator('#screen-shimai.active').waitFor();
    assert.equal(await page.locator('#shimai-confirm-modal').count(),0);
    await click(page,'[data-tab="home"]');await click(page,'[data-tab="genba"]');
    await page.locator('#screen-working.active').waitFor();
    assert.equal(JSON.parse((await stats(page)).raw).work_sessions.filter(s=>s.kind==='teiji').length,1);assert.deepEqual(page.errors,[]);await context.close();
  });
  // ── 今日の現場と定時(2026-10-25) ──
  await run('teiji: today here, opens on site next time, site rule fix, overtime only when pressed, 準備 for tomorrow, invoice shows overtime', async () => {
    // 開き直しを試すので、起動のたびに元へ戻す仕掛け(初期データの書き込み)は使わない
    const {page,context}=await setup(null);await page.evaluate(raw=>replaceStored(raw),JSON.stringify(fixture()));await page.reload();await ready(page);
    await click(page,'.site-card');
    assert.equal(await page.locator('#btn-teiji-fix').innerText(),'定時 8:00〜17:00');
    await click(page,'#btn-teiji-fix');await page.locator('#teiji-start').fill('08:30');await page.locator('#teiji-end').fill('17:30');await click(page,'#btn-teiji-save');
    assert.equal(await page.locator('#btn-teiji-fix').innerText(),'定時 8:30〜17:30');assert.equal(await page.locator('#handover-teiji .teiji-form').count(),0);
    assert.equal(await page.locator('#btn-today').innerText(),'今日はここ');
    await click(page,'#btn-today');await page.locator('#screen-working.active').waitFor();
    assert.match(await page.locator('#working-checkin-time').innerText(),/^定時 8:30〜17:30/);
    let d=JSON.parse((await stats(page)).raw);const day=d.work_sessions.find(s=>s.kind==='teiji');
    assert.equal(d.current_session ?? null,null);assert.equal(day.overtime_minutes,0);assert.deepEqual(d.projects[0].teiji,{start:'08:30',end:'17:30'});
    await page.reload();await page.locator('#screen-working.active').waitFor(); // 朝は■現場を開くだけ
    assert.equal(await page.locator('#site-list').count(),1);
    // 終業のあとにだけ、残業おつかれさまが出る
    const ended=await page.locator('#working-zangyo').isHidden();
    await page.evaluate(()=>{const d=JSON.parse(rawStored());const s=d.work_sessions.find(x=>x.kind==='teiji');s.check_out_at=Date.now()-40*60000;replaceStored(JSON.stringify(d));});
    await page.reload();await page.locator('#working-zangyo:not([hidden])').waitFor();
    assert.ok(ended || new Date().getHours()>=17,'hidden before the end of the day');
    await click(page,'#btn-zangyo');assert.equal(await page.locator('#zangyo-said').innerText(),'おつかれさまでした。');
    assert.match(await page.locator('#working-checkin-time').innerText(),/残業 1時間$/);
    d=JSON.parse((await stats(page)).raw);assert.equal(d.work_sessions.find(s=>s.kind==='teiji').overtime_minutes,60);
    await click(page,'#btn-zangyo-undo');d=JSON.parse((await stats(page)).raw);assert.equal(d.work_sessions.find(s=>s.kind==='teiji').overtime_minutes,0);
    await click(page,'#btn-zangyo');
    // 準備:明日の現場
    await click(page,'[data-tab="home"]');await page.locator('#junbi-project').selectOption('p');
    assert.equal(await page.locator('#junbi-project').inputValue(),'p');assert.equal(await page.locator('#junbi-now').innerText(),'定時 8:30〜17:30');
    d=JSON.parse((await stats(page)).raw);assert.equal(d.work_sessions.filter(s=>s.kind==='teiji').length,2);
    await click(page,'#btn-junbi-clear');assert.equal(await page.locator('#junbi-now').innerText(),'');
    // たたき台:同じ日の古い記録と定時は一日。残業は押した分だけ
    await click(page,'#btn-shimai-invoice');await click(page,'#btn-invoice-skip-expense');await page.locator('.invoice-card-title').waitFor();
    assert.match(await page.locator('#invoice-display').innerText(),/稼働日数\s*1日/);
    assert.match(await page.locator('#invoice-zangyo-row').innerText(),/1時間\(3,906円\)/);
    assert.deepEqual(page.errors,[]);await context.close();
  });
  // 依頼(10-25):応援も元請けの依頼も、同じ封筒一通。送るのは人(共有の画面)。受けるかは受けた人
  async function stubShare(page){await page.evaluate(()=>{window.shared=[];Object.defineProperty(navigator,'share',{value:async d=>{window.shared.push(d.text);},configurable:true});});}
  async function receive(page,text){if(await page.locator('#local-dialog[open]').count())await click(page,'#local-dialog .local-close');await click(page,'[data-tab="genba"]');if(await page.locator('#screen-working.active').count())await click(page,'[data-tab="genba"]');
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');await click(page,'#btn-import-json');await page.locator('#handoff-input').fill(text);await click(page,'#handoff-inspect');}
  await run('request: ask for help from Home, the other phone pastes it, the site, its hours and the day arrive only when chosen', async () => {
    const {page,context}=await setup();await ready(page);await stubShare(page);
    await click(page,'.site-card');await click(page,'#btn-teiji-fix');await page.locator('#teiji-start').fill('08:30');await page.locator('#teiji-end').fill('17:30');await click(page,'#btn-teiji-save');
    await click(page,'#btn-back-handover');await click(page,'[data-tab="home"]');await page.locator('#junbi-project').selectOption('p');
    const before=await stats(page);
    await click(page,'#btn-ouen');await page.locator('#req-name').waitFor();
    assert.equal(await page.locator('#req-name').inputValue(),'TEST');assert.equal(await page.locator('#req-start').inputValue(),'08:30');
    await page.locator('#req-from').fill('架空の職人');await page.locator('#req-note').fill('ボードの手が足りません');
    await click(page,'#req-make');await click(page,'#req-share');
    const text=(await page.evaluate(()=>window.shared))[0];
    assert.match(text,/【応援のお願い】架空の職人より/);assert.match(text,/時間:8:30〜17:30/);assert.match(text,/〔Senlings〕/);
    assert.deepEqual(await stats(page),before,'asking writes nothing');await context.close();
    const other=await setup(null);await other.page.locator('.site-empty').waitFor();
    await other.page.evaluate(()=>localStorage.setItem('senlings_homescreen_later','1'));
    await receive(other.page,`[LINE]\n${text}\n既読`);
    assert.match(await other.page.locator('#handoff-preview').innerText(),/応援のお願い\(架空の職人より\)/);
    assert.equal(await other.page.locator('#handoff-accept').isHidden(),true,'an envelope asks what to do');assert.equal(await other.page.locator('.request-choice').count(),5);
    await other.page.locator('#handoff-choices .mayottara summary').click();assert.match(await other.page.locator('#handoff-choices .mayottara').innerText(),/越えて/,'迷ったら、一般論');
    assert.equal(JSON.parse((await stats(other.page)).raw ?? 'null'),null,'nothing is kept before choosing');
    await click(other.page,'#choice-self');await other.page.locator('#handoff-place-day').waitFor();
    // 受けたら、依頼した人へのあいさつの下書き(送るのは本人。Senlings は残さない)
    const greet=await other.page.locator('#reply-greet').inputValue();
    assert.match(greet,/^架空の職人さん\n/);assert.match(greet,/TEST、伺います。/);
    await stubShare(other.page);await click(other.page,'#reply-send-greet');assert.equal((await other.page.evaluate(()=>window.shared)).at(-1),greet);
    let d=JSON.parse((await stats(other.page)).raw);
    assert.equal(d.projects.length,1);assert.equal(d.projects[0].project_slug,'TEST');assert.deepEqual(d.projects[0].teiji,{start:'08:30',end:'17:30'});
    assert.match(d.projects[0].site_info.raw,/ボードの手が足りません/);assert.doesNotMatch(d.projects[0].site_info.raw,/〔Senlings〕/);
    assert.equal(d.work_sessions.length,0,'the day is not placed until they choose');
    await click(other.page,'#handoff-place-day');d=JSON.parse((await stats(other.page)).raw);
    assert.equal(d.work_sessions.filter(s=>s.kind==='teiji').length,1);assert.equal(d.work_sessions[0].check_in_at,new Date(d.work_sessions[0].date+'T08:30:00+09:00').getTime());
    // 同じ文をもう一度:増えない
    await receive(other.page,text);assert.match(await other.page.locator('#local-dialog [role=status]').innerText(),/受取済み/);
    assert.equal(JSON.parse((await stats(other.page)).raw).projects.length,1);
    assert.deepEqual(other.page.errors,[]);await other.context.close();
  });
  await run('request: five choices before taking it on — later/decline/pass only draft a reply and keep nothing; together adds the site and opens 応援を呼ぶ', async () => {
    const {page,context}=await setup();await ready(page);await stubShare(page);
    await click(page,'.site-card');await click(page,'#btn-request-help'); // 申し送りの「この現場に人を頼む」
    await page.locator('#req-from').fill('架空の元請け');await click(page,'#req-make');await click(page,'#req-share');
    const text=(await page.evaluate(()=>window.shared))[0];await click(page,'#local-dialog .local-close');
    const other=await setup(null);const p=other.page;await p.locator('.site-empty').waitFor();await p.evaluate(()=>localStorage.setItem('senlings_homescreen_later','1'));await stubShare(p);
    for (const [id,re] of [['later',/その日は難しいです/],['decline',/見送らせてください/]]) {
      await receive(p,text);await click(p,`#choice-${id}`);assert.match(await p.locator(`#reply-${id}`).inputValue(),re);
      await click(p,`#reply-send-${id}`);assert.match((await p.evaluate(()=>window.shared)).at(-1),/^架空の元請けさん/);
      assert.equal(await p.evaluate(()=>localStorage.getItem('senlings_v0')),null,`${id} keeps nothing`);
    }
    await p.evaluate(n=>localStorage.setItem('senlings_v0',JSON.stringify({settings:{senlings_user_name:n}})),'つなぐ人');
    const kept0=await p.evaluate(()=>localStorage.getItem('senlings_v0'));
    await receive(p,text);await click(p,'#choice-pass');await click(p,'#reply-send-pass');
    const passed=(await p.evaluate(()=>window.shared)).at(-1);assert.match(passed,/^【応援のお願い】つなぐ人より\n/,'passing on is asking again in your own name');assert.doesNotMatch(passed,/架空の元請け/);
    assert.equal(await p.evaluate(()=>localStorage.getItem('senlings_v0')),kept0,'passing on keeps nothing');
    // 自分だけの控え(10-26):押したときだけ残る。請求にも CSV にも入らない。相手には何も送らない
    await p.locator('#tsunagi-to').fill('架空の田中さん');await click(p,'#tsunagi-save');
    assert.match(await p.locator('#tsunagi-keep [role=status]').innerText(),/控えを残しました\(TEST → 架空の田中さん\)/);
    const kept=JSON.parse(await p.evaluate(()=>localStorage.getItem('senlings_v0')));assert.equal(kept.tsunagi.length,1);assert.equal(kept.tsunagi[0].to,'架空の田中さん');assert.equal(kept.tsunagi[0].site_name,'TEST');assert.match(kept.tsunagi[0].text,/^【応援のお願い】つなぐ人より/);assert.doesNotMatch(kept.tsunagi[0].text,/〔Senlings〕/);
    assert.equal((kept.projects??[]).length,0,'still no site added');assert.equal((await p.evaluate(()=>window.shared)).length,(await p.evaluate(()=>window.shared)).length,'nothing sent by keeping');
    assert.equal(await p.locator('#tsunagi-save').isDisabled(),true,'kept once; the button rests');
    await click(p,'#local-dialog .local-close');await click(p,'[data-tab="shimai"]');await click(p,'#btn-review-records');
    assert.match(await p.locator('.local-record').first().innerText(),/TEST ／ つないだ控え[\s\S]*→ 架空の田中さん/);await click(p,'#local-dialog .local-close');
    // つないだ文を受けた人にも、元の差出人のまま届く
    const third=await setup(null);const q=third.page;await q.locator('.site-empty').waitFor();await q.evaluate(()=>localStorage.setItem('senlings_homescreen_later','1'));await q.evaluate(n=>localStorage.setItem('senlings_v0',JSON.stringify({settings:{senlings_user_name:n}})),'三人目');
    await receive(q,passed);assert.match(await q.locator('#handoff-preview').innerText(),/応援のお願い\(つなぐ人より\)/);
    // あいさつは、自分に頼んでくれた人(つなぐ人)へ。その先の依頼主へは越えない
    await click(q,'#choice-self');const g=await q.locator('#reply-greet').inputValue();
    assert.match(g,/^つなぐ人さん\n三人目です。/);assert.doesNotMatch(g,/架空の元請け/,'does not go over the head of the one who asked');
    await third.context.close();
    await receive(p,text);await click(p,'#choice-together');await p.locator('#reply-greet').waitFor();await click(p,'#handoff-ouen');await p.locator('#req-name').waitFor();
    assert.equal(await p.locator('#req-name').inputValue(),'TEST');assert.equal(JSON.parse(await p.evaluate(()=>localStorage.getItem('senlings_v0'))).projects.length,1);
    assert.deepEqual(p.errors,[]);await other.context.close();await context.close();
  });
  await run('request: a plain LINE text without the Senlings line still becomes a site; a cut-off line is refused without writing', async () => {
    const {page,context}=await setup(null);await page.locator('.site-empty').waitFor();await page.evaluate(()=>localStorage.setItem('senlings_homescreen_later','1'));
    await receive(page,'【応援】明日 田原町の現場 来れる?\n朝礼 8:20');
    assert.match(await page.locator('#handoff-preview').innerText(),/Senlings 用の行がない文/);
    assert.equal(await page.locator('#handoff-slug').inputValue(),'明日 田原町の現場 来れる?');
    await page.locator('#handoff-slug').fill('田原町');await click(page,'#handoff-accept');
    const d=JSON.parse((await stats(page)).raw);assert.equal(d.projects[0].project_slug,'田原町');assert.match(d.projects[0].site_info.raw,/朝礼 8:20/);
    const before=await stats(page);
    await receive(page,'【応援のお願い】x\n〔Senlings〕eyJmb3JtYXQiOiJzZW5saW5ncy5lbnZlbG9wZS');
    assert.match(await page.locator('#local-dialog [role=status]').last().innerText(),/まるごとコピー/);
    assert.equal(await page.locator('#handoff-accept').isDisabled(),true);assert.deepEqual(await stats(page),before);
    assert.deepEqual(page.errors,[]);await context.close();
  });
  // 知らせ・いざというとき(10-25):宛先はこの現場の担当。送るのは本人。何を送ったかは残さない
  const withContact = () => { const d = fixture(); d.projects[0].site_info = { contact: '架空の田中', contact_phone: '090-0000-0000' }; d.projects[0].address = '架空市1-1'; return d; };
  await run('me: 会社・名前・電話 from あなたのこと become the signature under requests and notices; mail, address and LINE stay out of LINE texts', async () => {
    const d=withContact();d.settings={senlings_company:'架空工業',senlings_user_name:'架空の職人',senlings_phone:'090-1111-2222',senlings_address:'架空市1-1',senlings_email:'a@example.test',senlings_line:'kakuu'};
    const {page,context}=await setup(JSON.stringify(d));await ready(page);await stubShare(page);
    await click(page,'.site-card');await click(page,'#btn-request-help');await click(page,'#req-make');await page.locator('#req-share:not([hidden])').waitFor();await click(page,'#req-share');
    const text=(await page.evaluate(()=>window.shared))[0];
    assert.match(text,/電話:090-0000-0000\n\n架空工業\n架空の職人\n090-1111-2222\n\nSenlings を使っている人は/,'the signature sits under the site block');
    assert.doesNotMatch(text,/a@example|kakuu/);assert.equal((text.match(/架空市1-1/g)||[]).length,1,'the site address once; my own address is not in the signature');
    await click(page,'#local-dialog .local-close');await click(page,'#btn-today');await page.locator('#screen-working.active').waitFor();await click(page,'#btn-shirase');await click(page,'#shirase-okure');await page.locator('#okure-at').fill('09:12');await click(page,'#okure-make');
    assert.match(await page.locator('#okure-preview').innerText(),/着きます。\n架空工業\n架空の職人\n090-1111-2222$/);
    await click(page,'#local-dialog .local-close');await context.close();
    // 受けた側のあいさつにも、受けた人の署名
    const other=await setup(JSON.stringify({projects:[],work_sessions:[],expenses:[],settings:{senlings_company:'受け工業',senlings_user_name:'受ける人',senlings_phone:'080-0000-0000'}}));await other.page.locator('.site-welcome').waitFor();
    await receive(other.page,text);await click(other.page,'#choice-self');
    assert.match(await other.page.locator('#reply-greet').inputValue(),/よろしくお願いします。\n\n受け工業\n受ける人\n080-0000-0000$/);
    assert.deepEqual(other.page.errors,[]);await other.context.close();
  });
  await run('seikyusaki: a site gets one 請求先 from the book (or a new one); the invoice draft shows it; the book is kept on the phone', async () => {
    const d=fixture();d.work_sessions=[{id:'w',project_id:'p',check_in_at:Date.now()-3600000,check_out_at:Date.now(),break_minutes:0}];
    const {page,context}=await setup(JSON.stringify(d));await ready(page);
    await click(page,'.site-card');assert.equal(await page.locator('#btn-seikyusaki').innerText(),'請求先を決める');
    await click(page,'#btn-seikyusaki');assert.equal(await page.locator('#seikyusaki-pick').count(),0,'empty book: no picker yet');
    await page.locator('#seikyusaki-company').fill('株式会社 架空建装');await page.locator('#seikyusaki-address').fill('〒111-0035 東京都台東区西浅草1-7-4');await page.locator('#seikyusaki-person').fill('架空の田中');await page.locator('#seikyusaki-email').fill('t@example.test');
    assert.equal(await page.locator('#seikyusaki-preview').innerText(),'〒111-0035\n東京都台東区西浅草1-7-4\n株式会社 架空建装　御中\n担当:架空の田中');
    await click(page,'#seikyusaki-save');assert.match(await page.locator('#local-dialog [role=status]').innerText(),/架空建装 を、この現場の請求先にしました/);
    await click(page,'#local-dialog .local-close');assert.equal(await page.locator('#btn-seikyusaki').innerText(),'請求先:株式会社 架空建装');
    let s=JSON.parse((await stats(page)).raw);assert.equal(s.seikyusaki.length,1);assert.equal(s.projects[0].seikyusaki_id,s.seikyusaki[0].id);
    // たたき台の下にも出る。変えるときはそこから
    await click(page,'[data-tab="home"]');await click(page,'#btn-shimai-invoice');await click(page,'#btn-invoice-skip-expense');await page.locator('.invoice-card-title').waitFor();
    assert.equal(await page.locator('#invoice-seikyusaki-label').innerText(),'請求先:株式会社 架空建装 / 架空の田中');
    await click(page,'#btn-invoice-seikyusaki');assert.equal(await page.locator('#seikyusaki-pick').inputValue(),s.seikyusaki[0].id,'the book now has one, and it is selected');
    await page.locator('#seikyusaki-person').fill('架空の佐藤');await click(page,'#seikyusaki-save');await click(page,'#local-dialog .local-close');
    s=JSON.parse((await stats(page)).raw);assert.equal(s.seikyusaki.length,1,'same company → the same page in the book, corrected');assert.equal(s.seikyusaki[0].person,'架空の佐藤');
    assert.equal(await page.locator('#invoice-seikyusaki-label').innerText(),'請求先:株式会社 架空建装 / 架空の佐藤');
    await click(page,'#btn-invoice-seikyusaki');await click(page,'#seikyusaki-clear');await click(page,'#local-dialog .local-close');
    assert.match(await page.locator('#invoice-seikyusaki-label').innerText(),/^請求先を決める/);s=JSON.parse((await stats(page)).raw);assert.equal(s.seikyusaki.length,1,'the book keeps it');assert.equal(s.projects[0].seikyusaki_id,null);
    assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('shirase: 遅れます with the Google Maps arrival (+10, by 5) and 事故渋滞; writes nothing; SMS and tel go to the site contact', async () => {
    const {page,context}=await setup(JSON.stringify(withContact()));await ready(page);await stubShare(page);await working(page);
    const before=await stats(page);
    await click(page,'#btn-shirase');await click(page,'#shirase-okure');
    assert.match(await page.locator('#okure-maps').getAttribute('href'),/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
    await page.locator('#okure-at').fill('09:12');assert.equal(await page.locator('#okure-yoyuu').innerText(),'余裕をみて 9:25 ごろ、と書きます。');
    await page.locator('#okure-jiko').check();await click(page,'#okure-make');
    const text=await page.locator('#okure-preview').innerText();
    assert.equal(text,'架空の田中さん\nTEST、事故渋滞で遅れます。すみません。\nGoogleマップでは 9:12 着、余裕をみて 9:25 ごろ着きます。');
    assert.equal(await page.locator('#okure-sms').getAttribute('href'),`sms:09000000000?&body=${encodeURIComponent(text)}`.replace('09000000000','09000000000'));
    assert.equal(await page.locator('#shirase-tel').getAttribute('href'),'tel:09000000000');
    await click(page,'#okure-share');assert.equal((await page.evaluate(()=>window.shared))[0],text);
    await page.locator('#okure-at').fill('09:40');assert.equal(await page.locator('#okure-preview').isHidden(),true,'changing the form hides the old text');
    assert.deepEqual(await stats(page),before,'a notice writes nothing');assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('shirase: 休みます today — text to the contact, then 休みにする removes only that day, 取り消す puts it back, 代わりを頼む opens 応援を呼ぶ for that day', async () => {
    const {page,context}=await setup(JSON.stringify(withContact()));await ready(page);await stubShare(page);await working(page);
    await click(page,'#btn-shirase');await click(page,'#shirase-yasumi');
    assert.equal(await page.locator('#yasumi-date').inputValue(),await page.evaluate(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}));
    assert.equal(await page.locator('#yasumi-off').isVisible(),false,'nothing to press before the text');
    await click(page,'#yasumi-make');
    assert.match(await page.locator('#yasumi-preview').innerText(),/^架空の田中さん\n今日のTEST、休ませてください。申し訳ありません。\n代わりに入れる人を、こちらで当たっています。/);
    const count=async()=>JSON.parse((await stats(page)).raw).work_sessions.filter(s=>s.kind==='teiji').length;
    assert.equal(await count(),1,'sending the text alone does not change the day');
    assert.match(await page.locator('#yasumi-off').innerText(),/^今日を休みにする/);
    await click(page,'#yasumi-off');assert.equal(await count(),0);assert.match(await page.locator('#yasumi-off-msg').innerText(),/休みにしました/);
    assert.equal(JSON.parse((await stats(page)).raw).work_sessions.length,1,'the old in/out record stays');
    await click(page,'#yasumi-off');assert.equal(await count(),1,'取り消す puts the day back');
    await click(page,'#yasumi-off');assert.equal(await count(),0);
    await click(page,'#yasumi-kawari-btn');await page.locator('#req-name').waitFor();
    assert.equal(await page.locator('#req-name').inputValue(),'TEST');assert.equal(await page.locator('#req-date').inputValue(),await page.locator('#req-date').inputValue());
    assert.equal(await page.locator('#req-contact').inputValue(),'架空の田中');
    assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('kinkyu: 人が倒れた and 火事 open at once from 迷ったら押す, 119 first, the 速報 has the place, nothing is kept', async () => {
    const {page,context}=await setup(JSON.stringify(withContact()));await ready(page);await stubShare(page);await working(page);
    const before=await stats(page);
    await click(page,'#btn-sos');await click(page,'#btn-kinkyu-taore');
    assert.equal(await page.locator('#kinkyu-119').getAttribute('href'),'tel:119');
    assert.match(await page.locator('.kinkyu-steps').innerText(),/あなたは 119/);
    await page.locator('#kinkyu-place').fill('HB棟 2階');await click(page,'#kinkyu-make');
    assert.match(await page.locator('#kinkyu-preview').innerText(),/^【速報】人が倒れました\(\d+:\d\d\)\n現場:TEST\n場所:HB棟 2階\nAED を持ってきてください。119 をお願いします。$/);
    assert.equal(await page.locator('#kinkyu-tel').getAttribute('href'),'tel:09000000000');
    await click(page,'#local-dialog .local-close');
    await click(page,'#btn-kinkyu-kaji');
    assert.match(await page.locator('.kinkyu-steps li').first().innerText(),/^まず逃げる。/);
    assert.match(await page.locator('.kinkyu-fuku').innerText(),/水はかけない/);
    await click(page,'#kinkyu-make');assert.match(await page.locator('#kinkyu-preview').innerText(),/^【速報】火事です/);
    assert.deepEqual(await stats(page),before,'emergencies keep no record');assert.deepEqual(page.errors,[]);await context.close();
  });
  const iosUA = v => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.split('_')[0]}.0 Mobile/15E148 Safari/604.1`;
  // 開いて何もない、は避ける(10-25 夜):依頼のリンクなら依頼、施設のリンクなら施設、何も無ければ次に押すもの
  async function makeLink(){const {page,context}=await setup(JSON.stringify(withContact()));await ready(page);await stubShare(page);
    await click(page,'.site-card');await click(page,'#btn-request-help');await page.locator('#req-from').fill('架空の職人');await click(page,'#req-make');await page.locator('#req-preview:not([hidden])').waitFor();
    assert.match(await page.locator('#req-preview').innerText(),/Senlings で開く → \S+\(この依頼が開くリンク\)/,'the long link is folded in the preview');
    await click(page,'#req-share');const text=(await page.evaluate(()=>window.shared))[0];await context.close();
    const link=text.match(/Senlings で開く → (\S+)/)[1];assert.match(link,/\?openExternalBrowser=1#r=z/);return {text,link:link.replace(/^https?:\/\/[^/]+/,origin)};}
  await run('arrival: empty start shows what to press, not nothing', async () => {
    const {page,context}=await setup(null);await page.locator('.site-welcome').waitFor();
    assert.match(await page.locator('.site-welcome').innerText(),/まだ現場がありません/);
    assert.deepEqual(await page.locator('.site-welcome button').allInnerTexts(),['自分で現場を立てる\n名前ひとつで。あとから直せます','施設を見る\n施設の決まりと、仲間の四人']);
    assert.equal(await page.locator('#btn-receive-property').count(),0,'no copy-and-paste entrance (10-26)');assert.equal(await page.locator('#handoff-paste').count(),0);
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');await click(page,'#btn-import-json');await page.locator('#handoff-file').waitFor();
    assert.equal(await page.locator('#handoff-input').isVisible(),true);assert.equal(await page.locator('#handoff-inspect').isVisible(),true);assert.match(await page.locator('#local-dialog h2').innerText(),/ファイルで受け取る/);await click(page,'#local-dialog .local-close');
    await click(page,'[data-tab="genba"]');await click(page,'#btn-welcome-shisetsu');await page.locator('#screen-shisetsu.active').waitFor();
    await click(page,'[data-tab="genba"]');await click(page,'#btn-welcome-add');await page.locator('#add-site-modal:not([hidden])').waitFor();
    assert.equal((await stats(page)).writes,0);assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('arrival: a request link opens the request itself (five choices, nothing kept), the # is cleared, and choosing works', async () => {
    const {link}=await makeLink();
    const {page,context}=await setup(null);await page.locator('.site-welcome').waitFor();
    await page.goto(link);await page.locator('#handoff-choices:not([hidden])').waitFor();
    assert.match(await page.locator('#handoff-preview').innerText(),/応援のお願い\(架空の職人より\)/);
    assert.equal(await page.evaluate(()=>location.hash),'','the # is read once and cleared');
    assert.equal(await page.evaluate(()=>rawStored()),null,'nothing is kept before choosing');
    await click(page,'#choice-self');await page.locator('#reply-greet').waitFor();
    const d=JSON.parse(await page.evaluate(()=>rawStored()));assert.equal(d.projects[0].project_slug,'TEST');assert.equal(d.projects[0].site_info.contact,'架空の田中');
    await page.reload();await ready(page);assert.equal(await page.locator('#handoff-choices').count(),0,'reopening does not ask again');
    assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('arrival: on iPhone the guide comes first with the request on top; 置かずに見る opens the request; in LINE, Safari carries the request', async () => {
    const {text,link}=await makeLink();
    const {page,context}=await setup(null,{ua:iosUA('26_0')});await page.locator('#homescreen-guide[open]').waitFor();await click(page,'#homescreen-later');
    await page.evaluate(()=>localStorage.removeItem('senlings_homescreen_later'));
    await page.goto(link);await page.locator('#homescreen-guide[open]').waitFor();
    assert.match(await page.locator('#homescreen-arrival').innerText(),/届いています\n【応援のお願い】架空の職人より/);
    assert.equal(await page.locator('#homescreen-why').innerText(),'置いて、ホーム画面から開くと、この依頼が出ます。');
    assert.match(await page.locator('#homescreen-open-step').innerText(),/ホーム画面の\s*を開く\s*→ この依頼が出ます/);
    assert.equal(await page.locator('#homescreen-copy').count(),0,'no copy-and-paste (10-26)');assert.equal(await page.locator('#homescreen-already').count(),0);
    assert.equal(await page.locator('#homescreen-later').innerText(),'いまは置かずに、ここで見る');void text;
    await click(page,'#homescreen-later');await page.locator('#handoff-choices:not([hidden])').waitFor();
    assert.equal(await page.evaluate(()=>rawStored()),null);await context.close();
    const line=await setup(null,{ua:iosUA('26_0').replace('Safari/604.1','Safari Line/14.0.0')});
    await line.page.goto(link);await line.page.locator('#homescreen-guide[open]').waitFor();
    const href=await line.page.locator('#homescreen-safari').getAttribute('href');
    assert.ok(href.startsWith(link+'&k='),'Safari で開く keeps the request and hands over the key');
    const lineKey=await line.page.evaluate(()=>localStorage.getItem('senlings_yubin_key'));assert.equal(href.split('&k=')[1],lineKey);assert.deepEqual(line.page.errors,[]);await line.context.close();
  });
  await run('arrival: while the guide is open the address and a cookie carry the request (iPhone manifest has no start_url, so the address is the icon)', async () => {
    const {link}=await makeLink();const code=link.split('#')[1];
    const {page,context}=await setup(null,{ua:iosUA('26_0')});await page.locator('#homescreen-guide[open]').waitFor();
    const m=await page.evaluate(async()=>(await fetch(document.querySelector('link[rel=manifest]').getAttribute('href'))).json());
    assert.equal(await page.evaluate(()=>document.querySelector('link[rel=manifest]').getAttribute('href')),'manifest-ios.json');
    assert.equal(m.start_url,undefined,'no start_url: the page address at add time becomes the icon');assert.equal(m.display,'standalone');assert.equal(m.scope,'./');
    await page.goto(link);await page.locator('#homescreen-arrival').waitFor();
    const key=await page.evaluate(()=>localStorage.getItem('senlings_yubin_key'));assert.match(key,/^[A-Za-z0-9_-]{22}$/,'a key is made in the browser');
    assert.equal(await page.evaluate(()=>location.hash),`#${code}&k=${key}`,'the address keeps the request and the key until they choose');
    assert.equal(await page.evaluate(()=>document.cookie),`senlings_todoki=${code}&k=${key}`,'the cookie carries the same (copied when the icon is made)');
    assert.equal(boxItems().length,1,'the request is also sealed into the post box');assert.doesNotMatch(JSON.stringify([...box.docs.values()]),/架空|TEST/,'sealed: the post office cannot read it');
    await click(page,'#homescreen-later');await page.locator('#handoff-choices:not([hidden])').waitFor();
    assert.equal(await page.evaluate(()=>location.hash),'');
    assert.deepEqual(page.errors,[]);await context.close();
    const android=await setup(null);assert.equal(await android.page.evaluate(()=>document.querySelector('link[rel=manifest]').getAttribute('href')),'manifest.json','other phones keep start_url');await android.context.close();
  });
  await run('arrival: opened from the home-screen icon (address or cookie), the request shows once; next launches start the usual way', async () => {
    const {link}=await makeLink();const code=link.split('#')[1];
    const {page,context}=await setup(null,{ua:iosUA('26_0'),standalone:true});await page.locator('.site-welcome').waitFor();
    assert.equal(await page.locator('#homescreen-guide').count(),0,'no guide inside the home-screen app');
    await page.goto(`${origin}/index.html#${code}`);await page.locator('#handoff-choices:not([hidden])').waitFor();
    for (const s of ['#handoff-input','#handoff-inspect','#handoff-accept']) assert.equal(await page.locator(s).isVisible(),false,`${s} stays away: only the request and the five choices`);
    assert.match(await page.locator('#handoff-preview').innerText(),/応援のお願い\(架空の職人より\)/);
    await click(page,'#local-dialog .local-close');
    await page.goto(`${origin}/`);await page.goto(`${origin}/index.html#${code}`);await page.locator('.site-welcome').waitFor();
    assert.equal(await page.locator('#handoff-choices').count(),0,'the same request does not come back at every launch');
    assert.equal(await page.evaluate(()=>location.hash),'');
    assert.equal(await page.evaluate(()=>rawStored()),null);assert.deepEqual(page.errors,[]);await context.close();
    // cookie だけが写ったとき(印の行き先が素のアドレスでも、依頼は届く)
    const c=await setup(null,{ua:iosUA('26_0'),standalone:true});await c.page.locator('.site-welcome').waitFor();
    await c.page.evaluate(code=>{document.cookie=`senlings_todoki=${code}&k=AAAAAAAAAAAAAAAAAAAAAA; Path=/; SameSite=Lax`;},code);
    await c.page.goto(`${origin}/`);await c.page.goto(`${origin}/index.html`);await c.page.locator('#handoff-choices:not([hidden])').waitFor();
    assert.equal(await c.page.evaluate(()=>document.cookie),'','read once, then gone');
    assert.equal(await c.page.evaluate(()=>localStorage.getItem('senlings_yubin_key')),'AAAAAAAAAAAAAAAAAAAAAA','the key copied with the icon is kept');
    await c.page.waitForFunction(()=>Number(localStorage.getItem('senlings_yubin_home_at')||0)>0);assert.ok([...box.docs.keys()].some(k=>/^boxes\/[A-Za-z0-9_-]{24}$/.test(k)),'the house leaves only its mark (no content) in the post box');
    await click(c.page,'#choice-self');await c.page.locator('#reply-greet').waitFor();
    assert.equal(JSON.parse(await c.page.evaluate(()=>rawStored())).projects[0].project_slug,'TEST');
    await c.page.goto(`${origin}/`);await c.page.goto(`${origin}/index.html`);await ready(c.page);assert.equal(await c.page.locator('#handoff-choices').count(),0);
    assert.deepEqual(c.page.errors,[]);await c.context.close();
  });
  await run('arrival: a facility link opens ●施設 with its name, even if the tab was put away; a cut request link says so', async () => {
    let {page,context}=await setup(null);await page.locator('.site-welcome').waitFor();
    await page.evaluate(()=>localStorage.setItem('senlings_shell_show_shisetsu','0'));
    await page.goto(`${origin}/?openExternalBrowser=1#shisetsu=${encodeURIComponent('架空の施設')}`);
    await page.locator('#screen-shisetsu.active').waitFor();
    assert.equal(await page.locator('#shisetsu-name').innerText(),'架空の施設');
    assert.equal(await page.locator('[data-tab="shisetsu"]').isVisible(),true);
    await page.reload();await page.locator('.site-welcome').waitFor();assert.equal(await page.locator('#shisetsu-name').innerText(),'架空の施設','the name stays');
    await context.close();
    const ios=await setup(null,{ua:iosUA('26_0')});await ios.page.locator('#homescreen-guide[open]').waitFor();
    const fh=`#shisetsu=${encodeURIComponent('架空の施設')}`;await ios.page.goto(`${origin}/?openExternalBrowser=1${fh}`);await ios.page.locator('#homescreen-arrival').waitFor();
    assert.match(await ios.page.locator('#homescreen-arrival').innerText(),/架空の施設の入口/);assert.equal(await ios.page.locator('#homescreen-why').innerText(),'置いて、ホーム画面から開くと、施設が出ます。');
    const fkey=await ios.page.evaluate(()=>localStorage.getItem('senlings_yubin_key'));
    assert.equal(await ios.page.evaluate(()=>location.hash),`${fh}&k=${fkey}`);assert.equal(await ios.page.evaluate(()=>document.cookie),`senlings_todoki=${fh.slice(1)}&k=${fkey}`);
    await click(ios.page,'#homescreen-later');assert.equal(await ios.page.evaluate(()=>location.hash),'');await ios.context.close();
    const home=await setup(null,{ua:iosUA('26_0'),standalone:true});await home.page.goto(`${origin}/index.html${fh}`);await home.page.locator('#screen-shisetsu.active').waitFor();
    assert.equal(await home.page.evaluate(()=>location.hash),'');
    await home.page.goto(`${origin}/`);await home.page.goto(`${origin}/index.html${fh}`);await home.page.locator('.site-welcome').waitFor();assert.equal(await home.page.locator('#screen-shisetsu.active').count(),0,'the icon still carries the entrance, but mornings start as usual');
    assert.equal(await home.page.locator('#shisetsu-name').innerText(),'架空の施設');await home.context.close();
    ({page,context}=await setup(null));await page.locator('.site-welcome').waitFor();
    await page.goto(`${origin}/?openExternalBrowser=1#r=zAAAA`);await page.locator('#handoff-input').waitFor();
    assert.match(await page.locator('#local-dialog [role=status]').first().innerText(),/途中で切れて/);
    assert.equal(await page.evaluate(()=>rawStored()),null);assert.deepEqual(page.errors,[]);await context.close();
  });
  // 郵便受け(10-26):置いたあとのリンクは、ブラウザで開いて家へ届く。郵便受けには封をした中身だけ。受け取ったら消える
  async function makeLinkAs(from, note){const {page,context}=await setup(JSON.stringify(withContact()));await ready(page);await stubShare(page);
    await click(page,'.site-card');await click(page,'#btn-request-help');await page.locator('#req-from').fill(from);await page.locator('#req-note').fill(note);await click(page,'#req-make');await page.locator('#req-share:not([hidden])').waitFor();
    await click(page,'#req-share');const text=(await page.evaluate(()=>window.shared))[0];await context.close();return text.match(/Senlings で開く → (\S+)/)[1].replace(/^https?:\/\/[^/]+/,origin);}
  await run('yubin: first link → guide with the key; the house takes the key with the icon; the second link is delivered through the sealed post box and opens in the house when it comes back; nothing readable or lasting stays in the box', async () => {
    const first=await makeLinkAs('架空の職人','一通目');const second=await makeLinkAs('架空の元請け','二通目');
    // ブラウザ(Chrome で iPhone):一通目
    const b=await setup(null,{ua:iosUA('26_0').replace('Version/26.0','CriOS/141.0')});await b.page.locator('#homescreen-guide[open]').waitFor();await click(b.page,'#homescreen-later');
    await b.page.evaluate(()=>localStorage.removeItem('senlings_homescreen_later'));
    await b.page.goto(first);await b.page.locator('#homescreen-arrival').waitFor();
    const key=await b.page.evaluate(()=>localStorage.getItem('senlings_yubin_key'));const carried=await b.page.evaluate(()=>location.hash);
    assert.ok(carried.endsWith(`&k=${key}`));assert.equal(boxItems().length,1,'the first request waits, sealed, in the box too');
    // 家(置いた印から):アドレスに一通目と鍵
    const h=await setup(null,{ua:iosUA('26_0'),standalone:true});await h.page.goto(`${origin}/index.html${carried}`);await h.page.locator('#handoff-choices:not([hidden])').waitFor();
    assert.match(await h.page.locator('#handoff-preview').innerText(),/一通目/);assert.equal(await h.page.evaluate(()=>localStorage.getItem('senlings_yubin_key')),key,'the house holds the same key');
    await h.page.waitForFunction(()=>Number(localStorage.getItem('senlings_yubin_home_at')||0)>0);
    await h.page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,300));
    assert.equal(boxItems().length,0,'the same request from the box is already seen, so it is taken out');
    await click(h.page,'#choice-self');await h.page.locator('#reply-greet').waitFor();await click(h.page,'#local-dialog .local-close');
    // ブラウザ:二通目。家があるので、置く案内ではなく「届けました」
    await b.page.goto(`${origin}/`);await b.page.goto(second);await b.page.locator('#delivered-note[open]').waitFor();
    assert.match(await b.page.locator('#delivered-note h2').innerText(),/届けました/);assert.match(await b.page.locator('#delivered-arrival').innerText(),/【応援のお願い】架空の元請けより/);
    assert.equal(await b.page.locator('#homescreen-guide').count(),0,'no second install guide');assert.equal(await b.page.evaluate(()=>location.hash),'');
    assert.equal(boxItems().length,1);assert.doesNotMatch(JSON.stringify([...box.docs.values()]),/二通目|架空|TEST/,'sealed');
    assert.equal(await b.page.evaluate(()=>rawStored()),null,'the browser keeps nothing');
    // 家に戻る:郵便受けを見て、二通目が開く。受け取ったら箱から消える
    await h.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))); /* 戻ってきた(実機では visibilitychange でも同じ) */
    await h.page.locator('#handoff-choices:not([hidden])').waitFor();assert.match(await h.page.locator('#handoff-preview').innerText(),/二通目/);
    await h.page.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,300));assert.equal(boxItems().length,0,'taken out of the box once shown');
    await click(h.page,'#local-dialog .local-close');
    await h.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))); /* 戻ってきた(実機では visibilitychange でも同じ) */await new Promise(r=>setTimeout(r,300));assert.equal(await h.page.locator('#local-dialog[open]').count(),0,'nothing comes twice');
    // 家が消えていた人の戻り道:「届けました」から置き方へ(鍵と依頼を持ったまま)
    await b.page.goto(`${origin}/`);await b.page.goto(second);await b.page.locator('#delivered-note[open]').waitFor();
    await click(b.page,'#delivered-guide');await b.page.locator('#homescreen-guide[open]').waitFor();
    assert.match(await b.page.locator('#homescreen-arrival').innerText(),/二通目|架空の元請け/);assert.match(await b.page.evaluate(()=>location.hash),new RegExp(`&k=${key}$`));
    await click(b.page,'#homescreen-later');await b.page.locator('#handoff-choices:not([hidden])').waitFor();await click(b.page,'#local-dialog .local-close');
    await b.page.evaluate(()=>localStorage.removeItem('senlings_homescreen_later'));
    // ブラウザで「ここで見る」も残っている(家で開かないと決めた人のため)
    await b.page.goto(`${origin}/`);await b.page.goto(second.replace(/#r=/,'#r=')+'');await b.page.locator('#delivered-note[open]').waitFor();
    await click(b.page,'#delivered-here');await b.page.locator('#handoff-choices:not([hidden])').waitFor();assert.match(await b.page.locator('#handoff-preview').innerText(),/二通目/);
    assert.deepEqual(b.page.errors,[]);assert.deepEqual(h.page.errors,[]);await b.context.close();await h.context.close();
  });
  await run('yubin: when the post office is down or closed, a first-timer still gets the install guide (address and cookie carry the request); with a known house the browser says 届けられませんでした and offers ここで見る', async () => {
    const link=await makeLinkAs('架空の職人','電波なし');
    const b=await setup(null,{ua:iosUA('26_0')});await b.page.locator('#homescreen-guide[open]').waitFor();await click(b.page,'#homescreen-later');await b.page.evaluate(()=>localStorage.removeItem('senlings_homescreen_later'));
    box.down=true;await b.page.goto(link);await b.page.locator('#homescreen-guide[open]').waitFor();
    assert.equal(await b.page.locator('#delivered-note').count(),0,'no post office yet → the guide, which does not need it');
    assert.match(await b.page.evaluate(()=>location.hash),/^#r=z.*&k=/);assert.match(await b.page.evaluate(()=>document.cookie),/^senlings_todoki=r=z.*&k=/);
    await click(b.page,'#homescreen-later');await b.page.locator('#handoff-choices:not([hidden])').waitFor();await click(b.page,'#local-dialog .local-close');
    // 家があると分かっているのに届かないとき
    box.down=false;const key=await b.page.evaluate(()=>localStorage.getItem('senlings_yubin_key'));
    const h=await setup(null,{ua:iosUA('26_0'),standalone:true});await h.page.evaluate(k=>localStorage.setItem('senlings_yubin_key',k),key);await h.page.goto(`${origin}/`);await h.page.waitForFunction(()=>Number(localStorage.getItem('senlings_yubin_home_at')||0)>0);await h.context.close();
    await b.page.evaluate(()=>localStorage.removeItem('senlings_homescreen_later'));
    const link2=await makeLinkAs('架空の職人','二通目・電波なし');
    box.down=true;await b.page.goto(`${origin}/`);
    // 家の印は読めない(503)ので、ここでも案内に戻る。読めて、入れられないときだけ「届けられませんでした」
    box.down=false;box.readOnly=true;await b.page.goto(link2);await b.page.locator('#delivered-note[open]').waitFor();
    assert.match(await b.page.locator('#delivered-note h2').innerText(),/届けられませんでした/);assert.match(await b.page.locator('#delivered-why').innerText(),/電波を確かめて.*503/);
    await click(b.page,'#delivered-here');await b.page.locator('#handoff-choices:not([hidden])').waitFor();assert.deepEqual(b.page.errors,[]);box.readOnly=false;await b.context.close();
    box.down=true;const h2=await setup(null,{ua:iosUA('26_0'),standalone:true});await h2.page.evaluate(()=>localStorage.setItem('senlings_yubin_key','AAAAAAAAAAAAAAAAAAAAAA'));await h2.page.goto(`${origin}/`);await h2.page.locator('.site-welcome').waitFor();
    await new Promise(r=>setTimeout(r,300));assert.equal(await h2.page.locator('#local-dialog[open]').count(),0,'the house just waits for next time');assert.deepEqual(h2.page.errors,[]);await h2.context.close();
  });
  // 受け口(10-26):職人が渡す → 元請けの PC がつながる → 現場の依頼を封をして直接届ける → 家で開く。外せば、届かない
  await run('ukeguchi: the house hands a port to a 元請け; the 元請け page connects, and delivers a request straight into the box; the house opens it and may make the sender its 請求先; removing the port stops later ones', async () => {
    // 家(ホーム画面の Senlings)で受け口を作る
    const h=await setup(JSON.stringify({projects:[],work_sessions:[],expenses:[],settings:{senlings_company:'受け工業',senlings_user_name:'受ける人',senlings_phone:'080-0000-0000'}}),{ua:iosUA('26_0'),standalone:true});
    await h.page.locator('.site-welcome').waitFor();await stubShare(h.page);
    await click(h.page,'[data-tab="home"]');await click(h.page,'#btn-tsunagari');await h.page.locator('#tsunagari-label').fill('架空建装');await click(h.page,'#tsunagari-make');
    const ptext=await h.page.locator('#tsunagari-text').innerText();assert.match(ptext,/^架空建装 ご担当の方\n受け工業 受ける人です。/);
    const plink=ptext.match(/https?:\S+/)[0].replace(/^https?:\/\/[^/]+/,origin);assert.match(plink,/\/irai\/\?openExternalBrowser=1#u=[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{22}&n=/);
    assert.match(await h.page.locator('#tsunagari-list').innerText(),/架空建装/);
    let hs=JSON.parse(await h.page.evaluate(()=>rawStored()));assert.equal(hs.ukeguchi.length,1);const key=await h.page.evaluate(()=>localStorage.getItem('senlings_yubin_key'));assert.ok(key,'the house has its own key now');
    await click(h.page,'#local-dialog .local-close');
    // 元請けの PC:受け口のリンクで開く → つながる
    const pc=await setup(null);await pc.page.goto(plink);await pc.page.locator('#tsunagari-list').waitFor();
    assert.match(await pc.page.locator('#tsunagari-msg').innerText(),/受ける人 とつながりました/);assert.match(await pc.page.locator('#tsunagari-list').innerText(),/受ける人/);
    assert.equal(await pc.page.evaluate(()=>location.hash),'','the port is read once and taken off the address');
    assert.equal(await pc.page.locator('#todoke').isHidden(),true,'nothing to deliver before a request is made');
    // 現場の依頼を作って、届ける
    await pc.page.locator('#req-from').fill('架空建装');await pc.page.locator('#req-name').fill('架空のモール 2階');await pc.page.locator('#composer .request-more summary').click();await pc.page.locator('#req-contact').fill('架空の田中');await pc.page.locator('#req-contact_phone').fill('03-0000-0000');await click(pc.page,'#req-make');
    await pc.page.locator('#todoke:not([hidden])').waitFor();await pc.page.locator('.todoke-pick').check();await click(pc.page,'#todoke-send');
    await pc.page.locator('#todoke-msg:has-text("届けました")').waitFor();assert.match(await pc.page.locator('#todoke-msg').innerText(),/届けました:受ける人/);
    assert.equal(boxItems().length,1);assert.doesNotMatch(JSON.stringify([...box.docs.values()]),/架空のモール|田中/,'sealed');
    // 家に戻る → 開く → 五択 → 自分で受ける → 差出人を請求先に
    await h.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
    await h.page.locator('#handoff-choices:not([hidden])').waitFor();assert.match(await h.page.locator('#handoff-preview').innerText(),/現場案内\(架空建装より\)[\s\S]*架空のモール 2階/);
    await click(h.page,'#choice-self');await h.page.locator('#handoff-seikyusaki').waitFor();await click(h.page,'#handoff-seikyusaki');
    assert.equal(await h.page.locator('#seikyusaki-company').inputValue(),'架空建装');assert.equal(await h.page.locator('#seikyusaki-person').inputValue(),'架空の田中');assert.equal(await h.page.locator('#seikyusaki-phone').inputValue(),'03-0000-0000');
    await click(h.page,'#seikyusaki-save');await click(h.page,'#local-dialog .local-close');
    hs=JSON.parse(await h.page.evaluate(()=>rawStored()));assert.equal(hs.projects[0].project_slug,'架空のモール 2階');assert.equal(hs.seikyusaki[0].company,'架空建装');assert.equal(hs.projects[0].seikyusaki_id,hs.seikyusaki[0].id);
    await new Promise(r=>setTimeout(r,300));assert.equal(boxItems().length,0,'taken out of the box');
    // 受け口を外す → 元請けが次を届けても、家では開かず消える
    await click(h.page,'[data-tab="home"]');await click(h.page,'#btn-tsunagari');await h.page.locator('[id^=tsunagari-rm-]').click();assert.match(await h.page.locator('#local-dialog [role=status]').innerText(),/受け口を外しました/);await click(h.page,'#local-dialog .local-close');
    await pc.page.locator('#req-name').fill('二つ目の現場');await click(pc.page,'#req-make');await pc.page.locator('#todoke:not([hidden])').waitFor();await pc.page.locator('.todoke-pick').check();await click(pc.page,'#todoke-send');await pc.page.locator('#todoke-msg:has-text("届けました")').waitFor();
    assert.equal(boxItems().length,1);
    await h.page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await new Promise(r=>setTimeout(r,500));
    assert.equal(await h.page.locator('#local-dialog[open]').count(),0,'nothing opens');assert.equal(boxItems().length,0,'and the sealed-with-a-removed-key envelope is swept');
    // 元請けの側でも外せる
    await pc.page.locator('[id^=tsunagari-rm-]').click();assert.match(await pc.page.locator('#tsunagari-list').innerText(),/まだありません/);
    assert.deepEqual(h.page.errors,[]);assert.deepEqual(pc.page.errors,[]);await h.context.close();await pc.context.close();
  });
  await run('arrival: the 元請け page makes a facility entrance link that opens ●施設', async () => {
    const {page,context}=await setup(null);await page.goto(origin+'/irai/');await stubShare(page);
    await page.locator('#shisetsu-name-in').fill('架空の施設');await click(page,'#shisetsu-make');
    const out=await page.locator('#shisetsu-out').innerText();assert.match(out,/^【架空の施設】Senlings の施設の入口です。/);
    const link=out.match(/https?:\S+/)[0];assert.equal(link,`${origin}/?openExternalBrowser=1#shisetsu=${encodeURIComponent('架空の施設')}`);
    await click(page,'#shisetsu-share');assert.equal((await page.evaluate(()=>window.shared))[0],out);
    await page.goto(link);await page.locator('#screen-shisetsu.active').waitFor();assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('request: the 元請け page makes the same envelope (kind 現場案内) and remembers only the sender name', async () => {
    const {page,context}=await setup(null);/* 本番(Vercel)は /irai/ で開く */ await page.goto(origin+'/irai/index.html');await stubShare(page);
    await page.locator('#req-from').fill('藤田建装 園原');await page.locator('#req-name').fill('M1070 架空の店');
    await click(page,'#req-make');await click(page,'#req-share');
    const text=(await page.evaluate(()=>window.shared))[0];assert.match(text,/^【現場のご案内】藤田建装 園原より/);
    assert.equal(await page.evaluate(()=>localStorage.getItem('senlings_irai_from')),'藤田建装 園原');
    assert.equal(await page.evaluate(()=>localStorage.getItem('senlings_v0')),null,'the page keeps no records');
    assert.match(await page.locator('.rule').innerText(),/契約している相手まで/,'the page says who to send to');
    await page.locator('.mayottara summary').click();assert.match(await page.locator('.mayottara').innerText(),/偽装請負/);
    const w=await page.evaluate(()=>[document.documentElement.scrollWidth,innerWidth,[...document.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>e.tagName+'.'+e.className).slice(0,5)]);assert.ok(w[0]<=w[1],JSON.stringify(w));assert.deepEqual(page.errors,[]);await context.close();
  });
  // ホーム画面に置く(10-25):入口は LINE、家はホーム画面。案内は一回だけ、催促しない、記録には触れない
  await run('homescreen: iOS 26 guide on first open, あとで is remembered, reopen from Home settings, no record write', async () => {
    const {page,context}=await setup(null,{ua:iosUA('26_0')});
    await page.locator('#homescreen-guide[open]').waitFor();
    const text=await page.locator('#homescreen-guide').innerText();
    assert.match(text,/「…」/);assert.match(text,/ホーム画面に追加/);assert.doesNotMatch(text,/JSON/,'no records here, so no moving note');
    assert.equal((await stats(page)).writes,0);
    await click(page,'#homescreen-later');assert.equal(await page.locator('#homescreen-guide').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('senlings_homescreen_later')),'1');
    await page.reload();await page.locator('.site-empty').waitFor();assert.equal(await page.locator('#homescreen-guide').count(),0,'not nagged');
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');assert.equal(await page.locator('#btn-homescreen').isVisible(),true);
    await click(page,'#btn-homescreen');await page.locator('#homescreen-guide[open]').waitFor();
    assert.equal((await stats(page)).writes,0);assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('homescreen: iOS 18 shows share first; LINE shows the Safari switch; with records the moving note appears', async () => {
    let r=await setup(null,{ua:iosUA('18_6')});await r.page.locator('#homescreen-guide[open]').waitFor();
    const steps=await r.page.locator('#homescreen-guide li').allInnerTexts();assert.equal(steps.length,5,'four taps, then open the icon');assert.match(steps[0],/共有/);assert.match(steps[1],/表示を増やす/);assert.match(steps[4],/ホーム画面の\s*を開く/);
    assert.equal(await r.page.locator('#homescreen-guide figure svg').count(),3,'three drawn pictures');assert.equal(await r.page.locator('#homescreen-guide figure img').count(),1,'one photo');
    assert.ok(await r.page.locator('#homescreen-guide figure img').evaluate(i=>i.complete&&i.naturalWidth>0),'photo loads');await r.context.close();
    r=await setup(JSON.stringify(fixture()),{ua:iosUA('26_0')+' Line/15.2.0'});await r.page.locator('#homescreen-guide[open]').waitFor();
    assert.match(await r.page.locator('#homescreen-safari').getAttribute('href'),/\?openExternalBrowser=1#k=[A-Za-z0-9_-]{22}$/,'Safari gets the key too, so the house made from Safari shares the post box');
    assert.doesNotMatch(await r.page.locator('#homescreen-guide').innerText(),/JSON/);await r.context.close();
    r=await setup(JSON.stringify(fixture()),{ua:iosUA('26_0')});await r.page.locator('#homescreen-guide[open]').waitFor();
    assert.match(await r.page.locator('#homescreen-guide').innerText(),/JSON/,'records already in this Safari: say they do not move');
    assert.equal((await stats(r.page)).writes,0);await r.context.close();
  });
  await run('homescreen: from the home screen itself, nothing is shown and the settings row is hidden', async () => {
    const {page,context}=await setup(JSON.stringify(fixture()),{ua:iosUA('26_0'),standalone:true});await ready(page);
    assert.equal(await page.locator('#homescreen-guide').count(),0);
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');assert.equal(await page.locator('#btn-homescreen').isVisible(),false);
    assert.deepEqual(page.errors,[]);await context.close();
  });
  // 見やすさ(10-25):▲ホームで選ぶ。この端末だけの好みで、記録(senlings_v0)には書かない
  await run('mieru: いちばん大きく by default; choose in Settings, remembered on reload, no record write, fits at 320px', async () => {
    const {page,context}=await setup();await page.setViewportSize({width:320,height:844});await ready(page);
    const before=await stats(page);
    const size=sel=>page.locator(sel).first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),'70','the default is the easiest to read');
    const big=await size('.site-slug');
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');assert.equal(await page.locator('#setting-mieru input[value="70"]').isChecked(),true);
    await page.locator('#setting-mieru label:has(input[value=""])').click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),undefined);
    await page.reload();await ready(page);
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),undefined,'ふつう is remembered');
    const base=await size('.site-slug');assert.ok(big>=base+3);
    for (const [v,min] of [['50',base+1],['70',base+3]]) {
      await click(page,'[data-tab="home"]');await click(page,'#btn-settings');
      await page.locator(`#setting-mieru label:has(input[value="${v}"])`).click();
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),v);
      await page.reload();await ready(page);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),v,'remembered on this device');
      assert.ok(await size('.site-slug')>=min);
      for (const tab of ['genba','shimai','home','mitsumori','shisetsu']) {
        await click(page,`[data-tab="${tab}"]`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${v} ${tab} fits`);
      }
      await click(page,'[data-tab="home"]');await click(page,'#btn-settings');assert.equal(await page.locator(`#setting-mieru input[value="${v}"]`).isChecked(),true);
    }
    assert.deepEqual(await stats(page),before,'the record is not touched');assert.deepEqual(page.errors,[]);await context.close();
  });
  for (const width of [320,390]) await run(`teiji: working screen with overtime fits at ${width}px`, async () => {
    const data=fixture();data.work_sessions.push(endedTeiji());
    const {page,context}=await setup(JSON.stringify(data));await page.setViewportSize({width,height:844});
    await page.locator('#working-zangyo:not([hidden])').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await click(page,'[data-tab="home"]');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if (process.env.EVIDENCE_DIR) await page.screenshot({path: path.join(process.env.EVIDENCE_DIR,`teiji-${width}.png`)});
    await context.close();
  });
  for (const width of [320,390]) {
    await run(`shell: five tabs fit at ${width}px without horizontal overflow`, async () => {
      const {page,context}=await setup();await page.setViewportSize({width,height:844});await ready(page);
      await click(page,'[data-tab="home"]');await click(page,'#btn-settings');await page.locator('#setting-show-shisetsu').check();
      for (const tab of ['shisetsu','genba','shimai','home','mitsumori']) {
        await click(page,`[data-tab="${tab}"]`);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),tab);
        if (process.env.EVIDENCE_DIR) await page.screenshot({path:path.join(process.env.EVIDENCE_DIR,`shell-${width}-${tab}.png`)});
      }
      assert.deepEqual(page.errors,[]);await context.close();
    });
  }
  // ── 仲間:下書きまで。出すのは職人。報告しない ──
  async function openFacility(page){await click(page,'[data-tab="home"]');await click(page,'#btn-settings');await page.locator('#setting-show-shisetsu').check();await click(page,'[data-tab="shisetsu"]');}
  await run('nakama Pon: tickets received make the parking row; edit in place keeps the original; deduction on the invoice draft and the monthly CSV', async () => {
    const {page,context}=await setup();await ready(page);await openFacility(page);
    await click(page,'#btn-nakama-pon');await page.locator('#local-dialog[data-nakama="pon"]').waitFor();
    assert.match(await page.locator('#local-dialog').innerText(),/まだありません/);
    assert.equal(await page.locator('#pon-more').evaluate(el=>el.open),true,'first time: the rate fold is open');
    // 単価が無いまま受け取ろうとすると、単価の口が開いて止まる
    await page.locator('#pon-ticket-count').fill('20');await click(page,'#pon-add-tickets');
    assert.match(await page.locator('#local-dialog [role=status]').first().innerText(),/単価/);
    assert.equal(await page.locator('.nakama-row').count(),0);
    await page.locator('#pon-rate').fill('1000');await page.locator('#pon-payer').fill('架空建装');await click(page,'#pon-save-rate');
    assert.equal(await page.locator('.nakama-row').count(),0,'days on site alone make no parking row');
    await page.locator('#pon-ticket-count').fill('20');await click(page,'#pon-add-tickets');
    await page.locator('.nakama-row').first().waitFor();
    assert.match(await page.locator('.nakama-row').first().innerText(),/駐車代\(チケット20枚\)　20,000円/);
    assert.match(await page.locator('.nakama-total').innerText(),/20,000円/);
    await page.locator('#pon-extra-amount').fill('8000');await click(page,'#pon-add-extra');
    assert.match(await page.locator('.nakama-total').innerText(),/28,000円/);
    const ticketRow=page.locator('.nakama-row[data-key^="ticket:"]');
    await ticketRow.getByRole('button',{name:'直す'}).click();await ticketRow.locator('.nakama-edit-input').fill('19000');await ticketRow.getByRole('button',{name:'残す'}).click();
    assert.match(await page.locator('.nakama-row[data-key^="ticket:"]').innerText(),/19,000円[\s\S]*元 20,000円/);
    assert.match(await page.locator('.nakama-total').innerText(),/27,000円/);
    await page.locator('.nakama-row[data-key^="extra:"]').getByRole('button',{name:'外す'}).click();
    assert.match(await page.locator('.nakama-total').innerText(),/19,000円/);
    await page.locator('.nakama-row--skipped').getByRole('button',{name:'戻す'}).click();
    assert.match(await page.locator('#pon-draft').inputValue(),/駐車代\(チケット20枚\)　19,000円[\s\S]*合計　27,000円/);
    const saved=JSON.parse((await stats(page)).raw);
    assert.deepEqual(saved.expenses,fixture().expenses);assert.deepEqual(saved.future,{keep:true});
    assert.equal(saved.nakama.pon.tickets[0].count,20);assert.equal(Object.values(saved.nakama.pon.edits)[0],19000);
    await page.setViewportSize({width:320,height:844});
    assert.ok(await page.locator('#local-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'pon dialog fits 320px');
    await page.locator('#local-dialog .local-close').click();
    await click(page,'#btn-nakama-pon');await page.locator('.nakama-row').first().waitFor();
    assert.equal(await page.locator('#pon-more').evaluate(el=>el.open),false,'second time: folded');
    await page.locator('#local-dialog .local-close').click();
    await click(page,'[data-tab="home"]');await click(page,'#btn-shimai-invoice');await click(page,'#btn-invoice-skip-expense');
    await page.locator('#invoice-pon-row').waitFor();assert.match(await page.locator('#invoice-pon-row').innerText(),/−27,000円/);
    const download=page.waitForEvent('download');await click(page,'#btn-export-csv-monthly-shimai');
    const csv=await fs.readFile(await (await download).path(),'utf8');
    assert.match(csv,/"立替\(勘定科目は確認中\)","19000",""[^\n]*駐車代\(チケット20枚\)\(架空建装\)/);
    assert.match(csv,/"立替\(勘定科目は確認中\)","8000",""/);
    assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('nakama Pon: a failed save keeps the stored bytes and says so', async () => {
    const {page,context}=await setup();await ready(page);await openFacility(page);
    await click(page,'#btn-nakama-pon');await page.locator('#pon-rate').fill('1000');
    const before=await inject(page,'writeError');await click(page,'#pon-save-rate');await page.locator('#storage-error[open]').waitFor();
    assert.equal((await stats(page)).raw,before.raw);assert.equal(await page.locator('.nakama-row').count(),0);await context.close();
  });
  await run('nakama Hoo, Kero, Kon: drafts follow trades; handed-over record and a gentle reminder; nothing is sent', async () => {
    const {page,context}=await setup();await ready(page);await openFacility(page);
    await click(page,'#btn-nakama-hoo');assert.match(await page.locator('#local-dialog').innerText(),/職種がまだありません[\s\S]*▲ホームの設定で選びます/);
    await page.locator('#local-dialog .local-close').click();
    await click(page,'[data-tab="home"]');await click(page,'#btn-settings');await page.locator('#setting-trades [data-trade="denki"]').check();
    await page.locator('#setting-trades-status').filter({hasText:'残しました'}).waitFor();
    await click(page,'[data-tab="shisetsu"]');await click(page,'#btn-nakama-hoo');
    assert.match(await page.locator('#local-dialog').innerText(),/職種：電気/);
    assert.match(await page.locator('#hoo-draft').inputValue(),/■ 電気[\s\S]*回路表示/);
    assert.doesNotMatch(await page.locator('#hoo-draft').inputValue(),/■ 内装/);
    await page.locator('#local-dialog').getByRole('button',{name:'渡したことを控える(コン)'}).click();
    await page.locator('#local-dialog .local-close').click();
    await click(page,'#btn-nakama-kero');assert.match(await page.locator('#kero-draft').inputValue(),/危険予知[\s\S]*職種：電気[\s\S]*危ないところ：/);
    await page.locator('#local-dialog .local-close').click();
    await click(page,'#btn-nakama-kon');await page.locator('.nakama-sent').first().waitFor();
    assert.match(await page.locator('.nakama-sent').first().innerText(),/完了の確かめ/);
    await page.locator('#kon-what').fill('搬出入届');await page.locator('#kon-to').fill('架空統括');await click(page,'#kon-add');
    const item=page.locator('.nakama-sent').filter({hasText:'搬出入届'});
    await item.getByRole('button',{name:'戻りのお願いを用意する'}).click();
    const text=await item.locator('textarea').inputValue();
    assert.match(text,/架空統括さん[\s\S]*お渡しした「搬出入届」/);assert.doesNotMatch(text,/至急|期限切れ/);
    await item.getByRole('button',{name:'戻ってきた'}).click();
    assert.match(await page.locator('.nakama-sent').filter({hasText:'搬出入届'}).innerText(),/戻り 20/);
    const n=JSON.parse((await stats(page)).raw).nakama;assert.deepEqual(n.trades,['denki']);assert.equal(n.kon.sent.length,2);
    assert.deepEqual(page.errors,[]);await context.close();
  });
  // The old UI's Firebase module is stubbed for behavior tests, never connected to a database.
  await run('old UI first use does not initialize storage; contact choices remain available', async () => {
    const {page,context}=await setup(null,{old:true}); await click(page,'[data-tab="tab-admin"]');
    await click(page,'#btn-new-project'); assert.equal(await page.locator('#f-contact option').count(),11);
    assert.equal((await stats(page)).writes,0); assert.deepEqual(page.errors,[]); await context.close();
  });
  for (const mode of ['corrupt','readError','writeError']) {
    await run(`old UI invoice and skip ${mode}`,async()=>{
      const {page,context}=await setup(undefined,{old:true});
      await page.waitForFunction(()=>document.querySelector('#invoice-project-select')?.options.length>1);
      await click(page,'[data-tab="tab-settings"]');
      await page.locator('#invoice-project-select').selectOption('p');
      await click(page,'#btn-invoice');
      const before=await inject(page,mode);await click(page,'#btn-skip-expense');await page.locator('#storage-error[open]').waitFor();
      assert.equal((await stats(page)).raw,before.raw);assert.equal((await stats(page)).writes,mode==='writeError'?1:0);
      assert.doesNotMatch(await page.locator('#invoice-display').innerText(),/\[Invoice Snapshot\]/);assert.deepEqual(page.errors,[]);await context.close();
    });
  }
  await run('Excel refuses unreadable source before CDN fetch',async()=>{
    const {page,context}=await setup();await ready(page);const before=await inject(page,'corrupt');
    const name=await page.evaluate(async()=>{try{await (await import('/src/pwa/invoiceExport.js')).exportInvoiceToExcel({project_id:'p',year:2026,month:10});}catch(error){return error.name;}});
    assert.equal(name,'StorageReadError');assert.deepEqual(await stats(page),before);await context.close();
  });
  const oldActions = {
    arrive: {prepare: p => click(p,'.project-select-btn'), selector:'#btn-arrive', mode:'Moving'},
    exit: {prepare: async p=>{await click(p,'.project-select-btn');await click(p,'#btn-arrive');}, selector:'#btn-exit-site', mode:'OnSite'},
    checkout: {prepare: async p=>{await click(p,'.project-select-btn');await click(p,'#btn-arrive');await click(p,'#btn-checkin');}, selector:'#btn-checkout', mode:'Working'},
    expense: {prepare: async p=>{await click(p,'.project-select-btn');await click(p,'#btn-arrive');await p.locator('#f-exp-amount').fill('200');}, selector:'#btn-add-expense', mode:'OnSite'},
    contact: {prepare: async p=>{await click(p,'[data-tab="tab-admin"]');await click(p,'#btn-toggle-contacts');await p.locator('.cm-name').first().fill('TEST');}, selector:'.cm-save-btn'},
    register: {prepare: async p=>{await click(p,'[data-tab="tab-admin"]');await click(p,'#btn-new-project');await p.locator('#f-start-date').fill('2026-10-01');await p.locator('#f-slug').fill('TEST-NEW');await p.locator('#f-address').fill('TEST');await p.locator('#f-contact').selectOption('CM01');},selector:'#registration-form button[type="submit"]'},
  };
  for (const [name,action] of Object.entries(oldActions)) {
    for (const mode of ['corrupt','readError','writeError']) {
      await run(`old UI ${name} ${mode}: no state confirmation`, async()=>{
        const {page,context}=await setup(undefined,{old:true});await page.locator('.project-select-btn').waitFor();await action.prepare(page);
        const before=await inject(page,mode);await page.locator(action.selector).first().click();await page.locator('#storage-error[open]').waitFor();
        assert.equal((await stats(page)).raw,before.raw);assert.equal((await stats(page)).writes,mode==='writeError'?1:0);
        if(action.mode) assert.equal(await page.evaluate(async()=> (await import('/src/pwa/state.js')).getMode()),action.mode);
        assert.doesNotMatch(await page.locator('#expense-msg').innerText(),/追加しました/);
        assert.doesNotMatch(await page.locator('#form-result').innerText(),/登録完了/);
        assert.deepEqual(page.errors,[]);await context.close();
      });
    }
  }
  if (process.env.TEST_CDN === '1') {
    await run('old UI real Firebase CDN modules (database requests blocked)',async()=>{
      const {page,context}=await setup(undefined,{old:true,realFirebase:true});
      await page.locator('.project-select-btn').waitFor({timeout:20000});
      await click(page,'.project-select-btn');await click(page,'#btn-arrive');
      assert.equal(await page.evaluate(async()=>(await import('/src/pwa/state.js')).getMode()),'OnSite');
      assert.deepEqual(page.errors,[]);await context.close();
    });
  }
  console.log(`Browser tests passed: ${passed}`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
