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
async function setup(raw = JSON.stringify(fixture()), { old = false, readError = false, realFirebase = false, ua = undefined, standalone = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block', ...(ua ? { userAgent: ua } : {}) });
  if (standalone) await context.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { value: true }); });
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
    json: { prepare: shimai, selector: '#btn-export-json-shimai' },
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
    for (const selector of ['#btn-export-json-shimai','#btn-export-csv-monthly-shimai']) {
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
    await click(page,'[data-tab="home"]');assert.equal(await page.locator('#setting-show-shisetsu').isChecked(),true);
    await page.locator('#setting-show-shisetsu').uncheck();assert.deepEqual(await visible(),['現場','仕舞い','調査','ホーム']);
    await page.reload();await ready(page);
    assert.deepEqual(await visible(),['現場','仕舞い','調査','ホーム'],'putting it away is remembered');
    await click(page,'[data-tab="home"]');await page.locator('#setting-show-shisetsu').check();
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
  // ホーム画面に置く(10-25):入口は LINE、家はホーム画面。案内は一回だけ、催促しない、記録には触れない
  const iosUA = v => `Mozilla/5.0 (iPhone; CPU iPhone OS ${v} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${v.split('_')[0]}.0 Mobile/15E148 Safari/604.1`;
  await run('homescreen: iOS 26 guide on first open, あとで is remembered, reopen from Home settings, no record write', async () => {
    const {page,context}=await setup(null,{ua:iosUA('26_0')});
    await page.locator('#homescreen-guide[open]').waitFor();
    const text=await page.locator('#homescreen-guide').innerText();
    assert.match(text,/「…」/);assert.match(text,/ホーム画面に追加/);assert.doesNotMatch(text,/JSON/,'no records here, so no moving note');
    assert.equal((await stats(page)).writes,0);
    await click(page,'#homescreen-later');assert.equal(await page.locator('#homescreen-guide').count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('senlings_homescreen_later')),'1');
    await page.reload();await page.locator('.site-empty').waitFor();assert.equal(await page.locator('#homescreen-guide').count(),0,'not nagged');
    await click(page,'[data-tab="home"]');assert.equal(await page.locator('#btn-homescreen').isVisible(),true);
    await click(page,'#btn-homescreen');await page.locator('#homescreen-guide[open]').waitFor();
    assert.equal((await stats(page)).writes,0);assert.deepEqual(page.errors,[]);await context.close();
  });
  await run('homescreen: iOS 18 shows share first; LINE shows the Safari switch; with records the moving note appears', async () => {
    let r=await setup(null,{ua:iosUA('18_6')});await r.page.locator('#homescreen-guide[open]').waitFor();
    const steps=await r.page.locator('#homescreen-guide li').allInnerTexts();assert.equal(steps.length,3);assert.match(steps[0],/共有/);
    assert.equal(await r.page.locator('#homescreen-guide figure svg').count(),2,'two drawn pictures');assert.equal(await r.page.locator('#homescreen-guide figure img').count(),1,'one photo');
    assert.ok(await r.page.locator('#homescreen-guide figure img').evaluate(i=>i.complete&&i.naturalWidth>0),'photo loads');await r.context.close();
    r=await setup(JSON.stringify(fixture()),{ua:iosUA('26_0')+' Line/15.2.0'});await r.page.locator('#homescreen-guide[open]').waitFor();
    assert.match(await r.page.locator('#homescreen-safari').getAttribute('href'),/\?openExternalBrowser=1$/);
    assert.doesNotMatch(await r.page.locator('#homescreen-guide').innerText(),/JSON/);await r.context.close();
    r=await setup(JSON.stringify(fixture()),{ua:iosUA('26_0')});await r.page.locator('#homescreen-guide[open]').waitFor();
    assert.match(await r.page.locator('#homescreen-guide').innerText(),/JSON/,'records already in this Safari: say they do not move');
    assert.equal((await stats(r.page)).writes,0);await r.context.close();
  });
  await run('homescreen: from the home screen itself, nothing is shown and the settings row is hidden', async () => {
    const {page,context}=await setup(JSON.stringify(fixture()),{ua:iosUA('26_0'),standalone:true});await ready(page);
    assert.equal(await page.locator('#homescreen-guide').count(),0);
    await click(page,'[data-tab="home"]');assert.equal(await page.locator('#btn-homescreen').isVisible(),false);
    assert.deepEqual(page.errors,[]);await context.close();
  });
  // 見やすさ(10-25):▲ホームで選ぶ。この端末だけの好みで、記録(senlings_v0)には書かない
  await run('mieru: choose readability in Home, remembered on reload, no record write, fits at 320px', async () => {
    const {page,context}=await setup();await page.setViewportSize({width:320,height:844});await ready(page);
    const before=await stats(page);
    const size=sel=>page.locator(sel).first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize));
    const base=await size('.site-slug');
    await click(page,'[data-tab="home"]');assert.equal(await page.locator('#setting-mieru input[value=""]').isChecked(),true);
    for (const [v,min] of [['50',base+1],['70',base+3]]) {
      await page.locator(`#setting-mieru label:has(input[value="${v}"])`).click();
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),v);
      await page.reload();await ready(page);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),v,'remembered on this device');
      assert.ok(await size('.site-slug')>=min);
      for (const tab of ['genba','shimai','home','mitsumori','shisetsu']) {
        await click(page,`[data-tab="${tab}"]`);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${v} ${tab} fits`);
      }
      await click(page,'[data-tab="home"]');assert.equal(await page.locator(`#setting-mieru input[value="${v}"]`).isChecked(),true);
    }
    await page.locator('#setting-mieru label:has(input[value=""])').click();
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.mieru),undefined);
    assert.equal(await size('.shimai-action-btn'),15);
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
      await click(page,'[data-tab="home"]');await page.locator('#setting-show-shisetsu').check();
      for (const tab of ['shisetsu','genba','shimai','home','mitsumori']) {
        await click(page,`[data-tab="${tab}"]`);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),tab);
        if (process.env.EVIDENCE_DIR) await page.screenshot({path:path.join(process.env.EVIDENCE_DIR,`shell-${width}-${tab}.png`)});
      }
      assert.deepEqual(page.errors,[]);await context.close();
    });
  }
  // ── 仲間:下書きまで。出すのは職人。報告しない ──
  async function openFacility(page){await click(page,'[data-tab="home"]');await page.locator('#setting-show-shisetsu').check();await click(page,'[data-tab="shisetsu"]');}
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
    await click(page,'[data-tab="home"]');await page.locator('#setting-trades [data-trade="denki"]').check();
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
