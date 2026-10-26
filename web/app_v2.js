// app_v2.js
// Senlings 新UI メインJS

import { completeSession, saveReturnNote, placeTeiji, removeTeiji, markOvertime, setOvertime, setProjectTeiji, teijiOn, teijiOf, formatTeiji, formatMinutes, localDate, addDays, sessionDate, overtimePay } from './src/pwa/work.js';
import { getSetting, SETTINGS_KEYS } from './src/pwa/settings.js';
import { load, update } from './src/pwa/storage.js';
import { exportAllDataAsJSON } from './src/pwa/export.js';
import { exportMonthlyCSV, exportProjectCSV } from './src/pwa/csvExport.js';
import { generateSnapshot, UnconfirmedExpenseError } from './src/pwa/invoice.js';
import { setClaimStatus } from './src/pwa/expense.js';
import { exportInvoiceToExcel } from './src/pwa/invoiceExport.js';

import { receiveProject, giveProject, writeMemo, takePhoto, reviewRecords, editSettings, showContact, sosText, copyText, exportText } from './src/pwa/localFeaturesUI.js';
import { saveLocalRecord, contactPhone } from './src/pwa/localRecords.js';
import { openPon, openKon, openKero, openHoo, ponDeductionFor } from './src/pwa/nakamaUI.js';
import { HOO_TRADES, readNakama, setTrades } from './src/pwa/nakama.js';
import { homeScreenState, openHomeScreenGuide, readLater } from './src/pwa/homeScreen.js';
import { openRequestDialog, siteFromProject } from './src/pwa/requestUI.js';
import { readArrival, fromLinkCode, envelopeText, bodyText, dayLabel, fnv } from './src/pwa/envelope.js';
import { openShirase, openKinkyu } from './src/pwa/shiraseUI.js';

// ── データ読み込み ────────────────────────────────────────
function getAllData() {
  return load();
}

// ── 画面1: 現場トップ ────────────────────────────────────

// まだ現場が無いとき。開いて何もない、は避ける(10-25 夜 船長)。次に押すものを先に出す
function renderWelcome(list) {
  list.replaceChildren();
  const box = document.createElement('div'); box.className = 'site-welcome site-empty';
  const p = document.createElement('p');
  p.textContent = 'まだ現場がありません。\nLINE で依頼が届いたら、文をまるごとコピーして、ここへ。';
  p.style.whiteSpace = 'pre-line';
  const btn = (cls, id, main, sub, onclick) => {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: cls, id, textContent: main });
    const s = document.createElement('small'); s.textContent = sub; b.append(s); b.onclick = onclick; return b;
  };
  box.append(p,
    homeScreenState({ installPrompt }).kind === 'home'
      ? btn('site-welcome-main', 'btn-welcome-receive', 'コピーした依頼を開く', '置く前にコピーした依頼が、ここで開きます', () => receiveProject(renderSiteTop, { paste: true }))
      : btn('site-welcome-main', 'btn-welcome-receive', '受け取る', 'コピーした依頼の文を貼る', () => receiveProject(renderSiteTop)),
    btn('site-welcome-sub', 'btn-welcome-add', '自分で現場を立てる', '名前ひとつで。あとから直せます', () => document.getElementById('btn-add-site').click()));
  if (readShowShisetsu()) box.append(btn('site-welcome-sub', 'btn-welcome-shisetsu', '施設を見る', '施設の決まりと、仲間の四人', () => document.querySelector('[data-tab="shisetsu"]').click()));
  list.append(box);
}
function renderSiteTop() {
  const projects = (getAllData().projects ?? [])
    .filter(p => !p.archive);
  const data0 = load();
  const cs = data0.current_session ?? null;
  const today = teijiOn(data0, localDate(Date.now()));
  const todayProject = today && projects.find(p => p.project_id === today.project_id);

  const list = document.getElementById('site-list');
  if (!list) return;

  if (projects.length === 0) {
    renderWelcome(list);
    return;
  }

  // 今日の現場がいちばん上。押せば、もう舞台の上。
  const todayCard = todayProject ? `
      <button class="site-card site-card-today" id="site-card-today" data-project-id="${esc(todayProject.project_id)}">
        <span class="site-slug">${esc(todayProject.project_slug)}</span>
        <span class="site-address">${esc(teijiLabel(today))}</span>
      </button>` : '';

  list.innerHTML = todayCard + projects.filter(p => p !== todayProject || (cs && cs.project_id === p.project_id)).map(p => {
    if (cs && cs.project_id === p.project_id) {
      const label = formatCheckinLabel(cs.check_in_at);
      return `
        <div class="site-card-pending">
          <div class="site-card-pending-head">
            <span class="site-slug">${esc(p.project_slug)}</span>
            <span class="site-checkin-time">${esc(label)}</span>
          </div>
          <button class="site-card-resume-btn" data-project-id="${esc(p.project_id)}">続きから入る</button>
          <button class="site-card-cancel-btn" data-project-id="${esc(p.project_id)}">この入場を取り消す</button>
        </div>
      `;
    }
    return `
      <button class="site-card" data-project-id="${esc(p.project_id)}">
        <span class="site-slug">${esc(p.project_slug)}</span>
        <span class="site-address">${esc(p.address ?? '')}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.site-card').forEach(card => {
    card.addEventListener('click', () => {
      const project = projects.find(p => p.project_id === card.dataset.projectId);
      if (!project) return;
      if (card.id === 'site-card-today') goToWorking(project); else goToHandover(project);
    });
  });

  list.querySelectorAll('.site-card-resume-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const project = projects.find(p => p.project_id === btn.dataset.projectId);
      if (!project || !cs) return;
      goToWorking(project);
    });
  });

  list.querySelectorAll('.site-card-cancel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.confirming) {
        update(data => { data.current_session = null; return data; });
        renderSiteTop();
      } else {
        btn.dataset.confirming = '1';
        btn.textContent = '本当に取り消す';
      }
    });
  });
}

function esc(val) {
  if (!val) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatCheckinLabel(tsMs) {
  const d = new Date(tsMs);
  const now = new Date();
  const timeStr = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  return sameDay
    ? `入場 ${timeStr}`
    : `${d.getMonth() + 1}/${d.getDate()} 入場 ${timeStr}`;
}

// 定時の一日の見え方。「定時 8:00〜17:00」+ 押した日だけ残業。
function teijiLabel(s) {
  const t = { start: hm(s.check_in_at), end: hm(s.check_out_at) };
  return `定時 ${formatTeiji(t)}${s.overtime_minutes ? `・残業 ${formatMinutes(s.overtime_minutes)}` : ''}`;
}
function hm(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const todayStr = () => localDate(Date.now());

// ── 画面2: 申し送り ──────────────────────────────────────

const HANDOVER_CATEGORIES = [
  { key: 'entrance',         label: '現場アクセス' },
  { key: 'equipment',        label: '特殊装備・入場条件', alert: true },
  { key: 'parking',          label: '駐車場' },
  { key: 'toilet',           label: 'トイレ' },
  { key: 'morning_assembly', label: '朝礼' },
  { key: 'delivery',         label: '搬入' },
  { key: 'contact',          label: '連絡先' },
  { key: 'raw',              label: '届いた連絡' },
];

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

function renderHandover(project) {
  const siteInfo = project.site_info ?? {};
  const list = document.getElementById('handover-list');
  list.innerHTML = '';

  const items = HANDOVER_CATEGORIES.filter(c => siteInfo[c.key]);
  if (items.length === 0) {
    list.innerHTML = '<p class="handover-empty">申し送り情報はまだありません。</p>';
    return;
  }

  const alertColor = '#d95b29';
  items.forEach(cat => {
    const isAlert = cat.alert === true;
    const div = document.createElement('div');
    div.className = 'handover-item';
    div.innerHTML = `
      <button class="handover-header">
        <span class="handover-label"${isAlert ? ` style="color:${alertColor}"` : ''}>
          ${isAlert ? '⚠ ' : ''}${cat.label}
        </span>
        <span class="handover-chevron"${isAlert ? ` style="color:${alertColor}"` : ''}>›</span>
      </button>
      <div class="handover-body" hidden>
        <p class="handover-text"${cat.key === 'raw' ? ' style="white-space:pre-wrap"' : ''}>${esc(siteInfo[cat.key])}</p>
      </div>
    `;
    div.querySelector('.handover-header').addEventListener('click', () => {
      const body = div.querySelector('.handover-body');
      const isOpen = !body.hidden;
      body.hidden = isOpen;
      div.classList.toggle('open', !isOpen);
    });
    list.appendChild(div);
  });
}

function goToHandover(project) {
  document.getElementById('handover-site-name').textContent = project.project_slug;
  renderHandover(project);
  document.getElementById('btn-give-property').onclick = () => giveProject(project);
  document.getElementById('btn-request-help').onclick = () => openOuen(project);
  document.getElementById('btn-project-contact').onclick = () => showContact(project);
  renderHandoverTeiji(project);
  const todayBtn = document.getElementById('btn-today');
  const placed = teijiOn(load(), todayStr());
  todayBtn.textContent = placed?.project_id === project.project_id ? '現場へ' : placed ? '今日はここに変える' : '今日はここ';
  // 出勤は押さない。今日の現場を選んだ時点で、定時の一日が端末に置かれる。
  todayBtn.onclick = () => {
    const now = teijiOn(load(), todayStr());
    if (now?.project_id !== project.project_id) placeTeiji(project.project_id, todayStr());
    goToWorking(project);
  };
  showScreen('screen-handover');
}

// 現場の定時(現場の決まり。無ければ 8:00〜17:00)。直すのは、決まりが違うときだけ。
function renderHandoverTeiji(project) {
  const box = document.getElementById('handover-teiji');
  const fresh = (load().projects ?? []).find(p => p.project_id === project.project_id) ?? project;
  const t = teijiOf(fresh);
  box.replaceChildren();
  const fix = document.getElementById('btn-teiji-fix');
  fix.textContent = `定時 ${formatTeiji(t)}`;
  fix.onclick = () => {
    if (box.querySelector('.teiji-form')) { box.replaceChildren(); return; }
    const form = document.createElement('div');
    form.className = 'teiji-form';
    const start = Object.assign(document.createElement('input'), { type: 'time', value: t.start, id: 'teiji-start', step: 900 });
    const end = Object.assign(document.createElement('input'), { type: 'time', value: t.end, id: 'teiji-end', step: 900 });
    start.setAttribute('aria-label', '始業'); end.setAttribute('aria-label', '終業');
    const save = Object.assign(document.createElement('button'), { type: 'button', id: 'btn-teiji-save', textContent: '残す' });
    const msg = document.createElement('span'); msg.setAttribute('role', 'status');
    save.onclick = () => {
      try { setProjectTeiji(project.project_id, start.value, end.value, todayStr()); renderHandoverTeiji(project); }
      catch (e) { msg.textContent = e.message; }
    };
    form.append(start, '〜', end, save, msg);
    box.append(form); start.focus();
  };
}

document.getElementById('btn-back-handover')?.addEventListener('click', () => {
  renderSiteTop();
  showScreen('screen-site-top');
});

document.getElementById('btn-back-working')?.addEventListener('click', () => {
  showScreen('screen-handover');
});

// ── 画面3: 作業中 ────────────────────────────────────────

let currentProject = null;

// 以前の入った/出たの途中(更新の前に入場していた分)は、そのまま続きから帰れる。
function legacyEntry(project) {
  const cs = load().current_session ?? null;
  return cs && cs.project_id === project.project_id ? cs : null;
}

function renderWorkingTime(project) {
  const el = document.getElementById('working-checkin-time');
  const legacy = legacyEntry(project);
  const today = teijiOn(load(), todayStr());
  const zangyo = document.getElementById('working-zangyo');
  if (legacy) {
    const timeStr = new Date(legacy.check_in_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    el.textContent = `入場 ${timeStr}`;
    zangyo.hidden = true;
    return;
  }
  el.textContent = today?.project_id === project.project_id ? teijiLabel(today) : '';
  renderZangyo(project, today);
}

// 残業おつかれさま:終業を過ぎてから、静かに一つだけ出る。押さなければ残業は無し。
let zangyoTimer = null;
function renderZangyo(project, today) {
  const box = document.getElementById('working-zangyo');
  const btn = document.getElementById('btn-zangyo');
  const said = document.getElementById('zangyo-said');
  const undo = document.getElementById('btn-zangyo-undo');
  const mine = today?.project_id === project.project_id;
  box.hidden = !(mine && Date.now() > today.check_out_at);
  if (box.hidden) {
    clearTimeout(zangyoTimer);
    if (mine) zangyoTimer = setTimeout(() => { if (activeScreenId() === 'screen-working') renderWorkingTime(project); }, Math.min(today.check_out_at - Date.now() + 1000, 2 ** 31 - 1));
    return;
  }
  said.textContent = today.overtime_minutes ? 'おつかれさまでした。' : '';
  undo.hidden = !today.overtime_minutes;
  btn.onclick = () => {
    try { markOvertime(today.date); } catch (e) { said.textContent = e.message; return; }
    renderWorkingTime(project);
  };
  undo.onclick = () => {
    try { setOvertime(today.date, 0); } catch (e) { said.textContent = e.message; return; }
    renderWorkingTime(project);
  };
}

function goToWorking(project) {
  currentProject = project;
  document.getElementById('working-site-name').textContent = project.project_slug;
  renderWorkingTime(project);

  document.getElementById('btn-sos').onclick = () => {
    goToSos(project);
  };
  document.getElementById('btn-shirase').onclick = () => openShiraseFor(project);
  document.getElementById('btn-photo').onclick = () => {
    takePhoto(project);
  };
  document.getElementById('btn-memo').onclick = () => writeMemo(project);
  document.getElementById('btn-rest').onclick = () => {
    goToRest(project);
  };
  document.getElementById('btn-return').onclick = () => {
    goToReturn(project);
  };

  showScreen('screen-working');
}

// ── 知らせる(遅れます・休みます)。宛先はこの現場の担当。越えない。送るのは本人 ──
function openShiraseFor(project) {
  const fresh = (load().projects ?? []).find(p => p.project_id === project.project_id) ?? project;
  const placedOn = date => teijiOn(load(), date)?.project_id === project.project_id;
  openShirase(fresh, {
    me: getSetting(SETTINGS_KEYS.USER_NAME) ?? '',
    today: todayStr(),
    tomorrow: addDays(todayStr(), 1),
    phone: contactPhone(fresh),
    placedOn,
    onYasumi: date => { if (placedOn(date)) removeTeiji(date); renderWorkingTime(project); },
    onUndoYasumi: date => { placeTeiji(project.project_id, date); renderWorkingTime(project); },
    onKawari: date => {
      const f = (load().projects ?? []).find(p => p.project_id === project.project_id) ?? fresh;
      openRequestDialog({ kind: 'ouen', from: getSetting(SETTINGS_KEYS.USER_NAME) ?? '', site: siteFromProject(f, teijiOf(f)), workDate: date });
    },
  });
}

// ── 画面4: SOS ──────────────────────────────────────────

const SOS_OPTIONS = [
  { fieldKey: 'access_delivery', label: '入れない・搬入できない',      alert: false },
  { fieldKey: 'drawing_diff',    label: '図面と違う',                  alert: false },
  { fieldKey: 'fit_unknown',     label: '納まりがわからない',           alert: false },
  { fieldKey: 'contact_unknown', label: '誰に聞けばいいかわからない',   alert: false },
  { fieldKey: 'danger',          label: '危ない',                      alert: true  },
];

let selectedSosKey = null;

function renderSosOptions() {
  const list = document.getElementById('sos-options-list');
  list.innerHTML = '';
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:16px 20px 0;';

  SOS_OPTIONS.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'sos-option' + (opt.alert ? ' danger' : '');
    btn.dataset.key = opt.fieldKey;
    btn.innerHTML = `<span>${opt.label}</span><span class="sos-check">✓</span>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sos-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSosKey = opt.fieldKey;
      document.getElementById('btn-sos-send').disabled = false;
    });
    list.appendChild(btn);
  });
}

function showSosComplete(project, record) {
  const modal = document.getElementById('sos-complete-modal');
  const callBtn = document.getElementById('btn-sos-call');
  const phone = contactPhone(project);
  callBtn.hidden = !phone; // 電話番号がある現場だけ。空のボタンは出さない
  document.getElementById('sos-call-label').textContent = phone ? `担当者へ電話する：${phone}` : '電話する';
  callBtn.onclick = () => { if (phone) window.location.href = `tel:${phone}`; };
  const text = sosText(project, record, SOS_OPTIONS.find(o => o.fieldKey === record.field_key)?.label ?? record.field_key);
  document.getElementById('sos-copy-text').textContent = text;
  const status = document.getElementById('sos-delivery-status');
  status.textContent = phone ? '連絡先と内容を確かめて、電話や普段の連絡アプリで伝えてください。' : '電話番号は未登録です。届いた連絡の担当者に伝えてください。';
  document.getElementById('btn-sos-copy').onclick = () => copyText(text, status);
  document.getElementById('btn-sos-export').onclick = () => exportText(text);
  document.getElementById('btn-sos-wait').onclick = () => { modal.hidden = true; showScreen('screen-working'); };
  document.getElementById('btn-sos-again').onclick = () => { modal.hidden = true; goToSos(project); };
  modal.hidden = false;
}

function goToSos(project) {
  const signalId = uid();
  selectedSosKey = null;
  document.getElementById('sos-site-name').textContent = project.project_slug;
  document.getElementById('sos-memo').value = '';
  document.getElementById('btn-sos-send').disabled = true;
  renderSosOptions();
  // いざというとき:記録は残さない。すぐ開く
  const kinkyu = kind => openKinkyu(kind, project, { me: getSetting(SETTINGS_KEYS.USER_NAME) ?? '', phone: contactPhone(project) });
  document.getElementById('btn-kinkyu-taore').onclick = () => kinkyu('taore');
  document.getElementById('btn-kinkyu-kaji').onclick = () => kinkyu('kaji');

  document.getElementById('btn-back-sos').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-sos-send').onclick = () => {
    if (!selectedSosKey) return;
    const memo = document.getElementById('sos-memo').value;
    const record = saveLocalRecord({ id: signalId, project_id: project.project_id,
      kind: 'sos', field_key: selectedSosKey, text: memo, created_at: Date.now() });
    showSosComplete(project, record);
  };

  showScreen('screen-sos');
}

// ── 画面3-B: 休憩 ────────────────────────────────────────

function goToRest(project) {
  document.getElementById('rest-site-name').textContent = project.project_slug;

  document.getElementById('btn-back-rest').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-resume').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-sos-rest').onclick = () => {
    goToSos(project);
  };

  document.querySelectorAll('.rest-cat-btn').forEach(btn => {
    btn.onclick = () => {
      console.log('map category:', btn.textContent.trim());
    };
  });

  showScreen('screen-rest');
}

// ── 画面5: 山返し（帰還） ────────────────────────────────

const RETURN_MOOD = [
  { key: 'positive',    label: 'また入りたい' },
  { key: 'conditional', label: '複雑な気持ち' },
];

const RETURN_CATEGORIES = [
  { key: 'anzen',     label: '危なかったこと',   managementKey: '安全' },
  { key: 'hinshitsu', label: '仕上がり・納まり', managementKey: '品質' },
  { key: 'koutei',    label: '段取り・待ち時間', managementKey: '工程' },
  { key: 'genka',     label: '追加・材料・経費', managementKey: '原価' },
];

let selectedMood = null;
let selectedCategories = new Set();

function goToReturn(project) {
  const noteId = `return:${project.project_id}:${uid()}`;
  // 入った時刻は画面を開いたときのものを使う。あとから入れ替わっていたら、閉じずに止める(completeSession が照合する)
  const legacy = legacyEntry(project);
  selectedMood = null;
  selectedCategories = new Set();
  document.getElementById('return-site-name').textContent = project.project_slug;
  document.getElementById('return-memo').value = '';

  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.classList.remove('selected');
    btn.onclick = () => {
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMood = btn.dataset.mood;
    };
  });

  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.classList.remove('selected');
    btn.onclick = () => {
      btn.classList.toggle('selected');
      const cat = btn.dataset.cat;
      if (btn.classList.contains('selected')) {
        selectedCategories.add(cat);
      } else {
        selectedCategories.delete(cat);
      }
    };
  });

  document.getElementById('btn-back-return').onclick = () => {
    showScreen('screen-working');
  };

  document.getElementById('btn-return-send').onclick = () => {
    const memo = document.getElementById('return-memo').value;
    const note = (memo.trim() || selectedMood || selectedCategories.size) ? { text: memo, mood: selectedMood, categories: [...selectedCategories], visibility: 'private' } : null;
    if (legacy) {
      // 更新の前に入場していた分は、これまでどおり出た時刻で閉じる
      completeSession({
        id:            uid(),
        project_id:    project.project_id,
        check_in_at:   legacy.check_in_at,
        check_out_at:  Date.now(),
        break_minutes: 0,
        ...(note ? { personal_note: note } : {}),
      });
    } else if (note) {
      // 定時の一日は帰りに閉じなくていい。残すのは自分だけの一言だけ
      saveReturnNote({ id: noteId, project_id: project.project_id, note, at: Date.now() });
    } else {
      load(); // 読めないときは、帰ったことにしない
    }
    showReturnComplete();
  };

  showScreen('screen-return');
}

function showReturnComplete() {
  const modal = document.getElementById('return-complete-modal');

  document.getElementById('btn-return-complete').onclick = () => {
    modal.hidden = true;
    renderSiteTop();
    showScreen('screen-site-top');
  };

  document.getElementById('btn-return-to-shimai').onclick = () => {
    modal.hidden = true;
    // 現場は帰ったので、次に■現場を開いたときは現場トップから
    genbaScreen = 'screen-site-top';
    renderSiteTop();
    showScreen('screen-site-top');
    openTab('shimai');
  };

  modal.hidden = false;
}

// ── 請求書スナップショットカード ────────────────────────

function renderSnapshotCard(snapshot, projectSlug) {
  const hours = Math.floor(snapshot.total_work_minutes / 60);
  const mins  = snapshot.total_work_minutes % 60;
  const timeStr = mins > 0 ? `${hours}時間${mins}分` : `${hours}時間`;
  const isSkipped = snapshot.expense_claim_status === 'skipped';
  const expStr = isSkipped
    ? '経費:未記入のまま(0円で計上)'
    : `${(snapshot.total_expense_amount ?? 0).toLocaleString()}円`;
  return `
    <p class="invoice-card-title">請求書の下書き</p>
    <div class="invoice-card-row">
      <span class="invoice-card-label">現場</span>
      <span>${esc(projectSlug)}</span>
    </div>
    <div class="invoice-card-row">
      <span class="invoice-card-label">稼働日数</span>
      <span>${snapshot.total_work_days}日</span>
    </div>
    <div class="invoice-card-row">
      <span class="invoice-card-label">稼働時間</span>
      <span>${timeStr}</span>
    </div>
    ${snapshot.overtime_minutes ? `<div class="invoice-card-row" id="invoice-zangyo-row">
      <span class="invoice-card-label">残業</span>
      <span>${formatMinutes(snapshot.overtime_minutes)}(${overtimePay(snapshot.overtime_minutes, unitPrice()).toLocaleString()}円)</span>
    </div>` : ''}
    <div class="invoice-card-row${isSkipped ? ' invoice-card-row--note' : ''}">
      <span class="invoice-card-label">経費</span>
      <span class="invoice-card-value">${expStr}</span>
    </div>
  `;
}

function unitPrice() {
  const v = Number(getSetting(SETTINGS_KEYS.WORK_UNIT_PRICE));
  return Number.isFinite(v) && v > 0 ? v : 25000;
}

// ── ◆ 仕舞 ───────────────────────────────────────────────

function renderShimai() {
  const data = getAllData();
  const sessions = data.work_sessions ?? [];
  const today = todayStr();
  const todaySession = teijiOn(data, today) ?? sessions.find(s => sessionDate(s) === today);

  const recordEl = document.getElementById('shimai-today-record');
  if (todaySession) {
    const project = (data.projects ?? []).find(p => p.project_id === todaySession.project_id);
    recordEl.innerHTML = `
      <div class="today-record-name">${esc(project?.project_slug ?? todaySession.project_id)}</div>
      <div style="font-size:12px; color:#777; font-family:'Noto Serif JP',serif;">
        ${esc(project?.address ?? '')}
      </div>
    `;
  } else {
    recordEl.innerHTML = '<p class="today-record-empty">今日の記録はまだありません。</p>';
  }
}

// ── ▲ ホーム ─────────────────────────────────────────────
// 請求書のたたき台・持ち出し・設定は、仕舞からここへ載せ替えた(中身は同じ)

// 準備:前の晩に明日の現場を選ぶ。選べば、朝はもう現場の上。
function renderJunbi() {
  const box = document.getElementById('junbi');
  const msg = document.getElementById('junbi-status');
  const tomorrow = addDays(todayStr(), 1);
  const data = load();
  const projects = (data.projects ?? []).filter(p => !p.archive);
  const placed = teijiOn(data, tomorrow);
  const select = document.getElementById('junbi-project');
  select.replaceChildren(...[{ project_id: '', project_slug: '選ぶ ›' }, ...projects].map(p =>
    Object.assign(document.createElement('option'), { value: p.project_id, textContent: p.project_slug, selected: placed?.project_id === p.project_id })));
  const [, m, d] = tomorrow.split('-').map(Number);
  document.getElementById('junbi-date').textContent = `明日 ${m}/${d} の現場`;
  const now = document.getElementById('junbi-now');
  const placedProject = placed && projects.find(p => p.project_id === placed.project_id);
  now.textContent = placedProject ? teijiLabel(placed) : '';
  document.getElementById('junbi-hint').hidden = !!placedProject;
  document.getElementById('btn-junbi-clear').hidden = !placed;
  select.onchange = () => {
    try {
      if (select.value) placeTeiji(select.value, tomorrow); else removeTeiji(tomorrow);
      renderJunbi();
      msg.textContent = select.value ? '置きました。朝は、もう現場の上です。' : '';
    } catch (e) { msg.textContent = e.message; }
  };
  document.getElementById('btn-junbi-clear').onclick = () => {
    try { removeTeiji(tomorrow); renderJunbi(); msg.textContent = '外しました。'; } catch (e) { msg.textContent = e.message; }
  };
  box.hidden = false;
}

// 応援を呼ぶ:明日の現場(無ければ今日の現場)を入れて開く。送るのは職人。
function openOuen(project) {
  const data = load();
  const placed = teijiOn(data, addDays(todayStr(), 1)) ?? teijiOn(data, todayStr());
  const p = project ?? (placed && (data.projects ?? []).find(x => x.project_id === placed.project_id)) ?? null;
  const fresh = p && (data.projects ?? []).find(x => x.project_id === p.project_id);
  const day = placed && (!project || placed.project_id === project.project_id) ? placed.date : undefined;
  openRequestDialog({ kind: 'ouen', from: getSetting(SETTINGS_KEYS.USER_NAME) ?? '', site: siteFromProject(fresh, fresh ? teijiOf(fresh) : null), workDate: day });
}

function renderHome() {
  renderJunbi();
  document.getElementById('btn-ouen').onclick = () => openOuen(null);
  const facilityToggle = document.getElementById('setting-show-shisetsu');
  facilityToggle.checked = readShowShisetsu();
  facilityToggle.onchange = () => {
    writeShowShisetsu(facilityToggle.checked);
    applyShisetsuTab();
  };

  // ホーム画面に置く(置き方)。ホーム画面から開いているときは出さない
  const hsBtn = document.getElementById('btn-homescreen');
  const hs = homeScreenState({ installPrompt });
  hsBtn.hidden = !(hs.kind === 'ios' || hs.kind === 'android');
  hsBtn.onclick = () => offerHomeScreen(true);

  // 見やすさ・字の大きさ(この端末だけの好み。記録には入れない)
  const mieru = readMieru();
  document.querySelectorAll('#setting-mieru input[name=mieru]').forEach(r => {
    r.checked = r.value === mieru;
    r.onchange = () => { if (r.checked) { writeMieru(r.value); applyMieru(r.value); } };
  });

  // 職種はここで選ぶ(ホー・ケロ・今日の現場の人で使う)
  const tradeBox = document.getElementById('setting-trades');
  const tradeStatus = document.getElementById('setting-trades-status');
  tradeBox.querySelectorAll('label').forEach(l => l.remove());
  tradeStatus.textContent = '';
  let chosen = [];
  try { chosen = readNakama().trades; } catch (e) { tradeStatus.textContent = e.message; }
  for (const [key, trade] of Object.entries(HOO_TRADES)) {
    const label = document.createElement('label');
    const box = Object.assign(document.createElement('input'), { type: 'checkbox', checked: chosen.includes(key) });
    box.dataset.trade = key;
    box.onchange = () => {
      const next = [...tradeBox.querySelectorAll('input:checked')].map(i => i.dataset.trade);
      try { setTrades(next); tradeStatus.textContent = '残しました。'; }
      catch (e) { box.checked = !box.checked; tradeStatus.textContent = e.message; }
    };
    label.append(box, document.createTextNode(trade.label));
    tradeBox.append(label);
  }

  document.getElementById('btn-export-json-shimai').onclick = () => {
    exportAllDataAsJSON();
  };
  document.getElementById('btn-export-csv-monthly-shimai').onclick = () => {
    const month = new Date().toISOString().slice(0, 7);
    exportMonthlyCSV(month);
  };
  document.getElementById('btn-export-csv-project-shimai').onclick = () => {
    openProjectExport();
  };
  document.getElementById('btn-shimai-settings').onclick = () => {
    editSettings();
  };

  // ── 請求書下書き ──────────────────────────────────────
  const resultArea  = document.getElementById('invoice-result-area');
  const displayEl   = document.getElementById('invoice-display');
  const skipBtn     = document.getElementById('btn-invoice-skip-expense');
  const excelBtn    = document.getElementById('btn-invoice-excel');

  // 画面を開くたびリセット
  resultArea.style.display  = 'none';
  skipBtn.style.display     = 'none';
  excelBtn.style.display    = 'none';
  displayEl.innerHTML       = '';
  displayEl.className       = 'invoice-display';

  let invoiceCtx = null; // { project_id, project_code, year, month }

  function tryGenerate() {
    const { project_id, project_code, year, month } = invoiceCtx;
    displayEl.innerHTML  = '';
    displayEl.className  = 'invoice-display';
    skipBtn.style.display = 'none';
    excelBtn.style.display = 'none';
    try {
      const snapshot = generateSnapshot({ snapshot_id: uid(), project_id, project_code, year, month });
      const proj = (getAllData().projects ?? []).find(p => p.project_id === project_id);
      displayEl.innerHTML = renderSnapshotCard(snapshot, proj?.project_slug ?? project_id);
      // ポンの立替(差し引き)は、たたき台の画面にだけ出す。紙(Excel)への載せ方は船長が決める
      let deduction = 0;
      try { deduction = ponDeductionFor(project_id, year, month); } catch { deduction = 0; }
      if (deduction > 0) {
        displayEl.insertAdjacentHTML('beforeend', `
          <div class="invoice-card-row invoice-card-row--note" id="invoice-pon-row">
            <span class="invoice-card-label">差し引き(立替)</span>
            <span class="invoice-card-value">−${deduction.toLocaleString()}円</span>
          </div>
          <p class="later-note">ポンの内訳から。Excel にも一行で載り、内訳は別紙「立替内訳」に入ります。</p>`);
      }
      excelBtn.style.display = 'flex';
    } catch (err) {
      if (err instanceof UnconfirmedExpenseError) {
        displayEl.className = 'invoice-display invoice-display--warn';
        displayEl.textContent = '経費:未記入';
        skipBtn.style.display = 'block';
      } else {
        displayEl.textContent = `エラー: ${err.message}`;
      }
    }
  }

  document.getElementById('btn-shimai-invoice').onclick = () => {
    const data = getAllData();
    const now  = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth() + 1;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const sessions = (data.work_sessions ?? [])
      .filter(s => s.check_in_at && sessionDate(s).slice(0, 7) === ym)
      .sort((a, b) => b.check_in_at - a.check_in_at);
    if (sessions.length === 0) {
      resultArea.style.display = 'flex';
      displayEl.className      = 'invoice-display';
      displayEl.textContent    = '今月の稼働記録がありません。';
      return;
    }
    const project_id   = sessions[0].project_id;
    const proj         = (data.projects ?? []).find(p => p.project_id === project_id);
    invoiceCtx = { project_id, project_code: proj?.project_code ?? null, year, month };
    resultArea.style.display = 'flex';
    tryGenerate();
  };

  skipBtn.onclick = () => {
    if (!invoiceCtx) return;
    setClaimStatus(invoiceCtx.project_id, invoiceCtx.year, invoiceCtx.month, 'skipped');
    tryGenerate();
  };

  excelBtn.onclick = async () => {
    if (!invoiceCtx) return;
    excelBtn.disabled = true;
    try {
      await exportInvoiceToExcel({ project_id: invoiceCtx.project_id, year: invoiceCtx.year, month: invoiceCtx.month });
    } catch (err) {
      alert(`書き出しに失敗しました。\n${err.message}`);
    } finally {
      excelBtn.disabled = false;
    }
  };
}

// ── タブバー(●施設 → ■現場 → ◆仕舞 → ▲ホーム → 見積) ──────
// 仕舞は一日の終わりではなく、一つ納める所作。現場を出なくても行き来できる。
// ■現場へ戻ると、最後に居た現場の画面(作業中など)にそのまま戻る。

const GENBA_SCREENS = new Set(['screen-site-top', 'screen-handover', 'screen-working', 'screen-rest', 'screen-sos', 'screen-return']);
const TAB_SCREENS = { shisetsu: 'screen-shisetsu', shimai: 'screen-shimai', home: 'screen-home', mitsumori: 'screen-mitsumori' };
// 設定はホームの中の一枚。開いていても、タブは▲ホームのまま
document.getElementById('btn-settings').onclick = () => { renderHome(); showScreen('screen-settings'); };
document.getElementById('btn-back-settings').onclick = () => { renderHome(); showScreen('screen-home'); };
let genbaScreen = 'screen-site-top';

function activeScreenId() {
  return document.querySelector('.screen.active')?.id ?? null;
}

function setActiveTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
}

function openTab(name) {
  const current = activeScreenId();
  if (GENBA_SCREENS.has(current)) {
    // ■現場に居るときにもう一度押したら、現場トップへ(よくあるタブの作法)
    genbaScreen = name === 'genba' ? 'screen-site-top' : current;
  }
  setActiveTab(name);
  if (name === 'genba') {
    if (genbaScreen === 'screen-site-top') renderSiteTop();
    showScreen(genbaScreen);
    return;
  }
  if (name === 'shimai') renderShimai();
  if (name === 'home') renderHome();
  showScreen(TAB_SCREENS[name]);
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => openTab(tab.dataset.tab));
});

// ── ● 施設のタブの出し入れ(殻のあいだは、この端末の中の試しの設定) ──
const SHOW_SHISETSU_KEY = 'senlings_shell_show_shisetsu';

// 施設のタブは、はじめから出す(10-25 船長)。しまったときだけ覚えておく。
function readShowShisetsu() {
  try { return localStorage.getItem(SHOW_SHISETSU_KEY) !== '0'; } catch { return true; }
}

function writeShowShisetsu(on) {
  try {
    if (on) localStorage.removeItem(SHOW_SHISETSU_KEY);
    else localStorage.setItem(SHOW_SHISETSU_KEY, '0');
  } catch { /* 保存できなくても、この画面の間は出し入れできる */ }
}

function applyShisetsuTab() {
  const tab = document.querySelector('[data-tab="shisetsu"]');
  const on = document.getElementById('setting-show-shisetsu')?.checked ?? readShowShisetsu();
  tab.hidden = !on;
  if (!on && activeScreenId() === 'screen-shisetsu') openTab('genba');
}

// ── 見やすさ(ふつう/大きめ=50代向け/いちばん大きく=70代向け)。この端末の中の好み ──
const MIERU_KEY = 'senlings_mieru';
// はじめは「いちばん大きく」(10-25 船長)。ふつうを選んだら '0' を覚える
function readMieru() {
  try { const v = localStorage.getItem(MIERU_KEY); return v === '0' ? '' : v === '50' ? '50' : '70'; } catch { return '70'; }
}
function writeMieru(v) {
  try { localStorage.setItem(MIERU_KEY, v || '0'); } catch { /* 保存できなくても、この画面の間は効く */ }
}
function applyMieru(v) {
  if (v) document.documentElement.dataset.mieru = v; else delete document.documentElement.dataset.mieru;
}

// ── 現場追加 ──────────────────────────────────────────────

document.getElementById('btn-add-site')?.addEventListener('click', () => {
  document.getElementById('add-site-name').value = '';
  document.getElementById('add-site-raw').value = '';
  for (const id of ['add-site-address', 'add-site-contact', 'add-site-phone']) document.getElementById(id).value = '';
  document.getElementById('add-site-modal').hidden = false;
  document.getElementById('add-site-name').focus();
});

document.getElementById('btn-add-site-cancel')?.addEventListener('click', () => {
  document.getElementById('add-site-modal').hidden = true;
});

document.getElementById('btn-add-site-save')?.addEventListener('click', () => {
  const name = document.getElementById('add-site-name').value.trim();
  if (!name) {
    document.getElementById('add-site-name').focus();
    return;
  }

  const rawText = document.getElementById('add-site-raw').value || null;
  const now = Date.now();
  const d = new Date();
  const YYYYMMDD =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0');

  const project = {
    project_id:      `${YYYYMMDD}_${now}`,
    project_slug:    name,
    address:         document.getElementById('add-site-address').value.trim() || null,
    start_date:      null,
    project_code:    null,
    site_contact_id: null,
    master_id:       null,
    site_info:       { raw: rawText, contact: document.getElementById('add-site-contact').value.trim() || null, contact_phone: document.getElementById('add-site-phone').value.trim() || null },
    created_at:      now,
    archive:         false,
  };

  update(data => { data.projects.push(project); return data; });

  document.getElementById('add-site-modal').hidden = true;
  renderSiteTop();
});

window.addEventListener('senlings-storage-ready', () => {
  if (document.getElementById('screen-site-top').classList.contains('active')) renderSiteTop();
  if (document.getElementById('screen-shimai').classList.contains('active')) renderShimai();
  if (document.getElementById('screen-home').classList.contains('active') || document.getElementById('screen-settings').classList.contains('active')) renderHome();
});

document.getElementById('btn-receive-property').onclick = () => receiveProject(renderSiteTop);
document.getElementById('btn-nakama-pon').onclick = () => openPon();
document.getElementById('btn-nakama-kon').onclick = () => openKon();
document.getElementById('btn-nakama-kero').onclick = () => openKero();
document.getElementById('btn-nakama-hoo').onclick = () => openHoo();
document.getElementById('btn-review-records').onclick = reviewRecords;
document.getElementById('btn-contact-manager').onclick = () => showContact(null);

function openProjectExport() {
  const projects = load().projects;
  const dialog = document.getElementById('project-export-dialog');
  const select = document.getElementById('export-project');
  select.replaceChildren();
  for (const p of projects) {
    const option = document.createElement('option'); option.value = p.project_id; option.textContent = p.project_slug; select.append(option);
  }
  document.getElementById('btn-project-csv').disabled = !projects.length;
  document.getElementById('btn-project-csv').onclick = () => { if (select.value) exportProjectCSV(select.value); };
  dialog.showModal();
}

// 朝は■現場を開くだけ。今日の現場が置いてあれば、もう現場の上。
function openToday() {
  let data;
  try { data = load(); } catch { return false; }
  const today = teijiOn(data, todayStr());
  const project = today && (data.projects ?? []).find(p => p.project_id === today.project_id && !p.archive);
  if (!project || (data.current_session && data.current_session.project_id !== project.project_id)) return false;
  goToWorking(project);
  return true;
}

// ── ホーム画面に置く(入口は LINE、家はホーム画面。10-25 船長) ──
// 最初に開いた一回だけ案内を出す。何かを入れる前に(先に入れると、この置き場所に残る)。
// 「あとで」のあとは出さない。▲ホームの設定から開ける。Android は一押し(ブラウザが置かせてくれるとき)。
let installPrompt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; document.getElementById('homescreen-guide')?.remove(); });

function offerHomeScreen(force = false, arrival = null) {
  const state = homeScreenState({ installPrompt });
  if (!(state.kind === 'ios' || state.kind === 'android')) return false;
  if (!force && readLater()) return false;
  let data;
  try { data = load(); } catch { return false; } // 読めないときは、保存の画面に任せる
  const hasRecords = (data.projects ?? []).length > 0 || (data.work_sessions ?? []).length > 0;
  openHomeScreenGuide(state, { installPrompt, hasRecords, arrival, onLater: () => { const b = document.getElementById('btn-homescreen'); if (b) b.hidden = false; arrival?.onLater?.(); } });
  return true;
}

// ── リンクで来たとき(10-25 夜 船長「施設紹介なら施設、職人からならその現場。開いて何もないのは避ける」) ──
// 依頼のリンク:依頼が開く(受けるかは五択、選ぶまで何も残さない)。施設のリンク:●施設から始まる。
const SHISETSU_NAME_KEY = 'senlings_shisetsu_name';
function readShisetsuName() { try { return localStorage.getItem(SHISETSU_NAME_KEY) ?? ''; } catch { return ''; } }
function applyShisetsuName() {
  const name = readShisetsuName();
  const sub = document.getElementById('shisetsu-name');
  if (sub) { sub.textContent = name; sub.hidden = !name; }
}
// 一度開いた依頼のリンクは覚えておく(ホーム画面の印が依頼を持っていても、開くたびには出さない)
const SEEN_KEY = 'senlings_links_seen';
function seenLinks() { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function markSeen(id) { try { const v = seenLinks().filter(x => x !== id); v.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(v.slice(-50))); } catch { /* 覚えられなくても開ける */ } }
function clearHash() { try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* そのまま */ } }

// ホーム画面の印に、この依頼を持たせる(10-26 船長「ホーム画面に置いてもらってから、依頼が見られれば」)。
// iPhone はブラウザの側から「もう置いたか」を知らせてくれない。置いた印から開いたときだけ分かる。
// そこで、置く前のあいだだけ、印の行き先(start_url)を依頼の入ったアドレスにしておく。効くかは iPhone の実物で確かめる。
// 効かなくても、コピーした依頼を「受け取る」で貼れば開ける(二の矢)。
let carryUrl = null;
async function carryInIcon(hash) {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return;
  try {
    const m = await (await fetch('manifest.json')).json();
    const base = `${location.origin}/`;
    m.start_url = `${base}index.html${hash}`; m.scope = base; m.id = `${base}index.html`;
    m.icons = (m.icons ?? []).map(i => ({ ...i, src: new URL(i.src, base).href }));
    const next = URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' }));
    if (carryUrl) URL.revokeObjectURL(carryUrl);
    carryUrl = next; link.href = next;
  } catch { /* 持たせられなくても、コピーで渡せる */ }
}
function dropFromIcon() {
  const link = document.querySelector('link[rel="manifest"]');
  if (link && carryUrl) { link.href = 'manifest.json'; URL.revokeObjectURL(carryUrl); carryUrl = null; }
}

async function arrive() {
  const raw = location.hash;
  const a = readArrival(raw);
  if (!a) return false;
  if (a.request !== undefined) return arriveRequest(a.request, raw);
  // 一度読んだら、アドレスから外す(開き直しで二度出さない)
  clearHash();
  if (a.shisetsu !== undefined) {
    if (a.shisetsu) { try { localStorage.setItem(SHISETSU_NAME_KEY, a.shisetsu); } catch { /* 名前は出せなくても開ける */ } }
    writeShowShisetsu(true);
    const cb = document.getElementById('setting-show-shisetsu'); if (cb) cb.checked = true;
    applyShisetsuTab(); applyShisetsuName();
    document.querySelector('[data-tab="shisetsu"]').click();
    offerHomeScreen(false, { label: a.shisetsu ? `${a.shisetsu}の入口` : '施設の入口', hash: raw, later: 'いまは置かずに、施設を見る' });
    return true;
  }
  return false;
}

async function arriveRequest(code, raw) {
  const id = fnv(code);
  const home = homeScreenState({ installPrompt }).kind === 'home';
  // ホーム画面の印から開いて、もう見た依頼なら、いつもの朝へ
  if (home && seenLinks().includes(id)) { clearHash(); return false; }
  let env;
  try { env = await fromLinkCode(code); }
  catch (e) { clearHash(); receiveProject(renderSiteTop).querySelector('[role=status]').textContent = e.message; return true; }
  const text = envelopeText(env);
  const label = `${bodyText(env).split('\n')[0]}\n${env.work_date ? `${dayLabel(env.work_date)} ` : ''}${env.site.name}`;
  const open = () => { clearHash(); dropFromIcon(); markSeen(id); receiveProject(renderSiteTop, { text }); };
  // 先にホーム画面へ。置くあいだは、アドレスと印に依頼を持たせておく
  if (offerHomeScreen(false, { label, text, hash: raw, later: 'いまは置かずに、ここで見る', onLater: open })) { await carryInIcon(raw); return true; }
  open();
  return true;
}

// ── 初期化 ───────────────────────────────────────────────
document.querySelector('[data-tab="shisetsu"]').hidden = !readShowShisetsu();
applyShisetsuName();
renderSiteTop();
arrive().then(came => { if (!came) { openToday(); offerHomeScreen(); } });
// 開いたままのところへ、次のリンクが来たとき(# だけが変わる)
window.addEventListener('hashchange', () => { arrive(); });
