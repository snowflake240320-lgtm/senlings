// nakamaUI.js — 仲間の画面。芯(nakama.js)の下書きを見せて、出すかどうかは職人が決める。
import { load } from './storage.js';
import { getSetting, SETTINGS_KEYS } from './settings.js';
import { PON_KINDS, HOO_TRADES, ponRows, ponTotal, ponText, ponLabel, setPonRate, addPonExtra, togglePonRow, addPonTickets, editPonAmount,
  hooText, keroText, recordSent, markReturned, konReminderText, readNakama, localDate, ponOvertimeWithoutRate } from './nakama.js';
import { teijiOn } from './work.js';

const $ = (tag, text = '', attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });
const yen = n => `${Math.round(n).toLocaleString('ja-JP')}円`;
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => localDate(Date.now());
const thisMonth = () => today().slice(0, 7);
const userName = () => getSetting(SETTINGS_KEYS.USER_NAME) ?? '';

let dialog;
function panel(title, id) {
  dialog?.remove();
  dialog = $('dialog', '', { className: 'local-dialog', id: 'local-dialog' });
  dialog.dataset.nakama = id;
  dialog.setAttribute('aria-label', title);
  const head = $('header'); const close = $('button', '閉じる', { className: 'local-close', type: 'button' });
  close.onclick = () => { dialog.close(); dialog.remove(); }; head.append($('h2', title), close);
  dialog.append(head); document.body.append(dialog); dialog.showModal();
  return dialog;
}
const p = (parent, text, cls) => { const el = $('p', text); if (cls) el.className = cls; parent.append(el); return el; };
function button(parent, text, fn, id) {
  const b = $('button', text, { type: 'button', className: 'local-action', id: id ?? '' }); b.onclick = fn; parent.append(b); return b;
}
function field(parent, label, tag = 'input', attrs = {}) {
  const w = $('label', label); const input = $(tag, '', attrs); w.append(input); parent.append(w); return input;
}
function status(parent) { const el = p(parent, ''); el.setAttribute('role', 'status'); return el; }
function guard(msg, fn) { try { fn(); return true; } catch (e) { msg.textContent = e.message; return false; } }
function projects() { return (load().projects ?? []).filter(pr => !pr.archive); }
function projectSelect(parent, label, id) {
  const select = field(parent, label, 'select', { id });
  const data = load();
  const current = teijiOn(data, today())?.project_id ?? data.current_session?.project_id;
  for (const pr of projects()) select.append($('option', pr.project_slug, { value: pr.project_id, selected: pr.project_id === current }));
  return select;
}
function draftBox(parent, text, id) {
  const area = field(parent, '下書き(ここで直せます)', 'textarea', { rows: 12, id, value: text });
  const msg = status(parent);
  button(parent, 'コピーする', async () => {
    try { await navigator.clipboard.writeText(area.value); msg.textContent = 'コピーしました。まだ誰にも送っていません。'; }
    catch { msg.textContent = 'コピーできませんでした。下書きを長押しして選んでください。'; }
  });
  button(parent, 'テキストにする', () => {
    const url = URL.createObjectURL(new Blob([area.value], { type: 'text/plain;charset=utf-8' }));
    const a = $('a', '', { href: url, download: `senlings-${id}.txt` }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  return area;
}
// 渡したことの控えは、コンが預かる(職人が押したときだけ)
function sentButton(parent, what, projectIdOf) {
  const msg = status(parent);
  button(parent, '渡したことを控える(コン)', () => {
    if (guard(msg, () => recordSent({ id: uid(), at: today(), what, to: '', project_id: projectIdOf() }))) msg.textContent = 'コンが控えました。';
  });
}

// ── ポン ─────────────────────────────────────────────
// いちばん多い所作は「チケットを受け取った」。月末は内訳と下書き。単価と行を足す口はたたむ。
export function openPon(onChange = () => {}) {
  const box = panel('ポン ― 立替の内訳', 'pon');
  const ym = thisMonth();
  p(box, '元請けが立て替えた分の内訳。請求から差し引きます。');
  const msg = status(box);
  let first;
  if (!guard(msg, () => { first = !Object.keys(readNakama().pon.rates).length; })) return;

  const ticketSec = $('section'), listSec = $('section'), draftSec = $('section');
  const more = $('details', '', { className: 'nakama-more', id: 'pon-more', open: first });
  more.append($('summary', '単価と、行を足す'));
  box.append(ticketSec, listSec, draftSec, more);

  ticketSec.append($('h3', '駐車チケットを受け取った'));
  const select = projectSelect(ticketSec, '現場', 'pon-project');
  const tDate = field(ticketSec, '受け取った日', 'input', { type: 'date', value: today(), id: 'pon-ticket-date' });
  const tCount = field(ticketSec, '枚数', 'input', { type: 'number', inputMode: 'numeric', min: 1, step: 1, id: 'pon-ticket-count' });
  button(ticketSec, '受け取った', () => {
    if (guard(msg, () => addPonTickets({ id: uid(), date: tDate.value, project_id: select.value, count: tCount.value }))) {
      tCount.value = ''; msg.textContent = '残しました。'; render(); onChange();
    } else if (msg.textContent.includes('単価')) more.open = true;
  }, 'pon-add-tickets');

  const rateSec = $('section'); more.append(rateSec);
  rateSec.append($('h3', 'この現場の単価'));
  const rate = field(rateSec, 'チケット1枚の単価(円)', 'input', { type: 'number', inputMode: 'numeric', min: 0, id: 'pon-rate' });
  const otRate = field(rateSec, '時間外の負担金 1時間の単価(円)', 'input', { type: 'number', inputMode: 'numeric', min: 0, id: 'pon-overtime-rate' });
  const payer = field(rateSec, '立て替える人(会社)', 'input', { id: 'pon-payer', maxLength: 100 });
  const fill = () => guard(msg, () => { const r = readNakama().pon.rates[select.value]; rate.value = r?.parking_per_day || ''; otRate.value = r?.overtime_per_hour || ''; payer.value = r?.payer || ''; });
  select.addEventListener('change', fill); fill();
  button(rateSec, '単価を残す', () => {
    if (guard(msg, () => setPonRate(select.value, { parking_per_day: rate.value, overtime_per_hour: otRate.value, payer: payer.value }))) { msg.textContent = '残しました。'; render(); onChange(); }
  }, 'pon-save-rate');
  p(rateSec, '単価は施設の決まりを見て、自分で入れます。受け取った日の単価で残ります。', 'later-note');

  const extraSec = $('section'); more.append(extraSec);
  extraSec.append($('h3', '時間外・その他を足す'));
  const date = field(extraSec, '日付', 'input', { type: 'date', value: today(), id: 'pon-extra-date' });
  const kind = field(extraSec, '種類', 'select', { id: 'pon-extra-kind' });
  for (const [k, label] of Object.entries(PON_KINDS)) if (k !== 'parking') kind.append($('option', label, { value: k }));
  const amount = field(extraSec, '金額(円)', 'input', { type: 'number', inputMode: 'numeric', min: 0, id: 'pon-extra-amount' });
  const memo = field(extraSec, '一言(任意)', 'input', { maxLength: 200, id: 'pon-extra-memo' });
  button(extraSec, '一行足す', () => {
    if (guard(msg, () => addPonExtra({ id: uid(), date: date.value, project_id: select.value, kind: kind.value, amount: amount.value, memo: memo.value }))) {
      amount.value = ''; memo.value = ''; msg.textContent = '足しました。'; render(); onChange();
    }
  }, 'pon-add-extra');

  function editRow(li, r) {
    li.querySelector('.nakama-edit')?.remove();
    const form = $('div', '', { className: 'nakama-edit' });
    const input = $('input', '', { type: 'number', inputMode: 'numeric', min: 0, value: String(r.amount), className: 'nakama-edit-input' });
    input.setAttribute('aria-label', '金額(円)');
    const save = $('button', '残す', { type: 'button', className: 'nakama-mini' });
    save.onclick = () => { if (guard(msg, () => editPonAmount(r.key, input.value))) { render(); onChange(); } };
    form.append(input, save);
    if (r.edited) {
      const back = $('button', `元の${yen(r.original)}に戻す`, { type: 'button', className: 'nakama-mini' });
      back.onclick = () => { if (guard(msg, () => editPonAmount(r.key, ''))) { render(); onChange(); } };
      form.append(back);
    }
    li.append(form); input.focus();
  }

  function render() {
    listSec.replaceChildren($('h3', `${ym.replace('-', '年')}月の内訳`));
    draftSec.replaceChildren();
    let rows;
    if (!guard(msg, () => { rows = ponRows(load(), ym); })) return;
    if (!rows.length) p(listSec, 'まだありません。');
    let noRate = false; guard(msg, () => { noRate = ponOvertimeWithoutRate(load(), ym); });
    if (noRate) p(listSec, '残業の日の時間外は、単価を入れると下書きになります。', 'later-note');
    const ul = $('ul', '', { className: 'nakama-rows' }); listSec.append(ul);
    for (const r of rows) {
      const li = $('li', `${r.date}　${r.project}　${ponLabel(r)}　${yen(r.amount)}`, { className: r.skipped ? 'nakama-row nakama-row--skipped' : 'nakama-row' });
      li.dataset.key = r.key;
      li.append($('span', `${r.source}${r.memo ? `・${r.memo}` : ''}${r.edited ? `・元 ${yen(r.original)}` : ''}${r.skipped ? '・外しています' : ''}`));
      const tools = $('div', '', { className: 'nakama-tools' });
      if (!r.skipped) {
        const fix = $('button', '直す', { type: 'button', className: 'nakama-mini' });
        fix.onclick = () => editRow(li, r); tools.append(fix);
      }
      const t = $('button', r.skipped ? '戻す' : '外す', { type: 'button', className: 'nakama-mini' });
      t.onclick = () => { if (guard(msg, () => togglePonRow(r.key))) { render(); onChange(); } };
      tools.append(t); li.append(tools); ul.append(li);
    }
    p(listSec, `差し引き(立替)の合計　${yen(ponTotal(rows))}`, 'nakama-total');
    draftSec.append($('h3', '立替の内訳(別紙の下書き)'));
    draftBox(draftSec, ponText(rows, ym, userName()), 'pon-draft');
    sentButton(draftSec, `立替の内訳(${ym})`, () => select.value || null);
  }
  render();
}

// ── ケロ ─────────────────────────────────────────────
export function openKero() {
  const box = panel('ケロ ― 安全の書類', 'kero');
  p(box, '危険予知(KY)などの下書きを作ります。空欄は自分の言葉で。');
  const select = projectSelect(box, '現場', 'kero-project');
  const draft = $('section'); box.append(draft);
  const render = () => {
    draft.replaceChildren();
    const project = projects().find(pr => pr.project_id === select.value);
    draftBox(draft, keroText({ project, date: today(), userName: userName(), trades: readNakama().trades }), 'kero-draft');
    sentButton(draft, `KY(${today()})`, () => select.value || null);
  };
  select.onchange = render; render();
}

// ── ホー ─────────────────────────────────────────────
export function openHoo() {
  const box = panel('ホー ― 検査・是正・完了の書類', 'hoo');
  p(box, '職種で見どころが変わります。施設のチェックリストがあれば、そちらが正です。');
  const msg = status(box);
  let trades = [];
  guard(msg, () => { trades = readNakama().trades; });
  const names = trades.map(t => HOO_TRADES[t]?.label).filter(Boolean).join('・');
  p(box, names ? `職種：${names}` : '職種がまだありません。', 'nakama-trade-line');
  p(box, '職種は▲ホームの設定で選びます。', 'later-note');
  const select = projectSelect(box, '現場', 'hoo-project');
  const draft = $('section'); box.append(draft);
  function render() {
    draft.replaceChildren();
    const data = load();
    const project = projects().find(pr => pr.project_id === select.value);
    const photoCount = (data.photos ?? []).filter(ph => ph.project_id === select.value && !ph.deleted).length;
    draftBox(draft, hooText({ project, trades: readNakama().trades, photoCount, userName: userName(), date: today() }), 'hoo-draft');
    sentButton(draft, `完了の確かめ(${today()})`, () => select.value || null);
  }
  select.onchange = render; render();
}

// ── コン ─────────────────────────────────────────────
export function openKon() {
  const box = panel('コン ― 期限と戻り', 'kon');
  p(box, '渡した書類の控えです。戻りを待つものは、お願いの文を用意できます。');
  const msg = status(box);
  const add = $('section'); box.append(add); add.append($('h3', '渡したことを控える'));
  const what = field(add, '何を', 'input', { maxLength: 200, id: 'kon-what' });
  const to = field(add, '誰に(任意)', 'input', { maxLength: 100, id: 'kon-to' });
  const at = field(add, '渡した日', 'input', { type: 'date', value: today(), id: 'kon-at' });
  button(add, '控える', () => {
    if (guard(msg, () => recordSent({ id: uid(), at: at.value, what: what.value, to: to.value, project_id: load().current_session?.project_id ?? null }))) {
      what.value = ''; to.value = ''; msg.textContent = '控えました。'; render();
    }
  }, 'kon-add');
  const list = $('section'); box.append(list);
  function render() {
    list.replaceChildren($('h3', '控え'));
    let sent;
    if (!guard(msg, () => { sent = readNakama().kon.sent; })) return;
    if (!sent.length) p(list, 'まだありません。');
    for (const s of [...sent].reverse()) {
      const item = $('div', '', { className: 'nakama-sent' }); item.dataset.id = s.id;
      item.append($('p', `${s.at}　${s.what}${s.to ? `　→ ${s.to}` : ''}${s.returned_at ? `　(戻り ${s.returned_at})` : ''}`));
      const toggle = $('button', s.returned_at ? '戻りの印を外す' : '戻ってきた', { type: 'button', className: 'nakama-mini' });
      toggle.onclick = () => { if (guard(msg, () => markReturned(s.id, !s.returned_at))) render(); };
      item.append(toggle);
      if (!s.returned_at) {
        const ask = $('button', '戻りのお願いを用意する', { type: 'button', className: 'nakama-mini' });
        ask.onclick = () => { draftBox(item, konReminderText(s), `kon-reminder-${s.id}`); ask.remove(); };
        item.append(ask);
      }
      list.append(item);
    }
  }
  render();
}

export function ponDeductionFor(projectId, year, month) {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return ponTotal(ponRows(load(), ym), projectId);
}
