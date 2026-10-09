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
const server = http.createServer(async (req, res) => {
  const file = path.resolve(web, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!file.startsWith(web + path.sep)) return res.writeHead(403).end();
  try {
    const data = await fs.readFile(file);
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.html') ? 'text/html' : 'application/octet-stream');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
let browser, origin;
let passed = 0;
async function run(name, fn) { if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return; await fn(); console.log('PASS', name); passed++; }
async function setup(raw = JSON.stringify(fixture()), { old = false, readError = false, realFirebase = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (old && !realFirebase && url === origin + '/src/pwa/firebase.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `export async function syncProjectsFromFirestore(){return {added:0}}; export async function saveProjectToFirestore(){}; export async function pushAllProjectsToFirestore(){return {count:0}};` });
    }
    if (url.startsWith(origin + '/') || (realFirebase && url.startsWith('https://www.gstatic.com/firebasejs/'))) return route.continue();
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
async function shimai(page) { await click(page, '[data-tab="shimai"]'); }
async function working(page) { await click(page, '.site-card'); await click(page, '#btn-checkin'); }
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
    start: { prepare: p => click(p,'.site-card'), selector: '#btn-checkin', success: '#screen-working.active' },
    cancel: { prepare: async p => { await working(p); await click(p,'[data-tab="genba"]'); await click(p,'.site-card-cancel-btn'); }, selector: '.site-card-cancel-btn', success: '.site-card' },
    return: { prepare: async p => { await working(p); await click(p,'#btn-return'); }, selector: '#btn-return-send', success: '#return-complete-modal:not([hidden])' },
    invoice: { prepare: shimai, selector: '#btn-shimai-invoice', success: '.invoice-card-title' },
    skip: { prepare: async p => { await shimai(p); await click(p,'#btn-shimai-invoice'); }, selector: '#btn-invoice-skip-expense', success: '.invoice-card-title' },
    json: { prepare: shimai, selector: '#btn-export-json-shimai' },
    csv: { prepare: shimai, selector: '#btn-export-csv-monthly-shimai' },
  };
  for (const [name, action] of Object.entries(actions)) {
    for (const mode of ['corrupt', 'readError', 'writeError']) {
      if (mode === 'writeError' && ['json','csv'].includes(name)) continue;
      await run(`new UI ${name} ${mode}: no false success`, async () => {
        const data = fixture();
        if (name === 'invoice') data.expenses = [{ project_id: 'p', expense_date: new Date().toISOString().slice(0,10), amount: 10 }];
        const {page,context} = await setup(JSON.stringify(data));
        await ready(page); await action.prepare(page);
        let downloads = 0; page.on('download', () => downloads++);
        const before = await inject(page,mode);
        await click(page,action.selector);
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
    await click(page,'#btn-shimai-invoice'); await click(page,'#btn-invoice-skip-expense');
    await page.locator('.invoice-card-title').waitFor();
    for (const selector of ['#btn-export-json-shimai','#btn-export-csv-monthly-shimai']) {
      const download=page.waitForEvent('download'); await click(page,selector); const d=await download;
      const content=await fs.readFile(await d.path(),'utf8');
      assert.ok(content.includes(selector.includes('json') ? '"future"' : '労務費'));
    }
    const saved=JSON.parse((await stats(page)).raw);
    assert.equal(saved.current_session,null);assert.equal(saved.work_sessions.length,1);assert.equal(saved.invoice_snapshots.length,1);
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
  for (const faultType of ['write', 'read']) await run(`Return second ${faultType} fails: partial notice, no completion, same-screen retry no duplicate`, async () => {
    const {page,context}=await setup(); await ready(page);await working(page);await click(page,'#btn-return');
    await page.evaluate(type=>{fault.writes=0;if(type==='write')fault.failWrite=2;else fault.failRead=fault.reads+5;},faultType);await click(page,'#btn-return-send');
    await page.locator('#storage-error[open]').waitFor();
    assert.match(await page.locator('#storage-error').innerText(),/勤怠は保存済み/);
    assert.equal(await page.locator('#return-complete-modal:not([hidden])').count(),0);
    const before=JSON.parse((await stats(page)).raw);assert.equal(before.work_sessions.length,2);assert.ok(before.current_session);
    await page.evaluate(()=>{fault.failWrite=0;fault.failRead=0;});await click(page,'#storage-error button');await click(page,'#btn-return-send');
    await page.locator('#return-complete-modal:not([hidden])').waitFor();
    const after=JSON.parse((await stats(page)).raw);assert.equal(after.work_sessions.length,2);assert.equal(after.current_session,null);
    await context.close();
  });
  await run('new UI unreadable at final prewrite recheck: zero writes', async()=>{
    const {page,context}=await setup();await ready(page);await click(page,'.site-card');
    const before=await stats(page);await page.evaluate(()=>{fault.failRead=fault.reads+4;});await click(page,'#btn-checkin');
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
