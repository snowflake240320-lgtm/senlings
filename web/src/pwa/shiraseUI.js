// shiraseUI.js — 知らせる(遅れます・休みます)と、いざというとき(人が倒れた・火事)の画面。
// 文を下書きして、送るのは本人。Senlings は既読も催促も、何を送ったかも持たない。
import { okureText, yasumiText, sokuhouText, mapsLink, smsLink, yoyuu, FUKU_NI_HI, KINKYU, atena } from './shirase.js';
import { dayLabel } from './envelope.js';

const $ = (tag, text = '', attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });

let dialog;
function open(title, cls = '') {
  dialog?.remove();
  dialog = $('dialog', '', { className: `local-dialog shirase-dialog ${cls}`.trim(), id: 'local-dialog' });
  dialog.setAttribute('aria-label', title);
  const head = $('header');
  const close = $('button', '閉じる', { className: 'local-close', type: 'button' });
  close.onclick = () => { dialog.close(); dialog.remove(); }; // 閉じたら片づける(同じ id の箱を二つ残さない)
  head.append($('h2', title), close);
  dialog.append(head);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * 文を見せて、送る口(LINE など・SMS・電話・コピー)を並べる。
 * make() が投げたら、その言葉を出す。
 */
function sendBox(box, make, { phone, idp, after } = {}) {
  const msg = $('p', '', { className: 'request-msg', id: `${idp}-msg` }); msg.setAttribute('role', 'status');
  const show = $('button', '文を見る', { type: 'button', className: 'local-action', id: `${idp}-make` });
  const pre = $('pre', '', { className: 'request-preview', id: `${idp}-preview`, hidden: true });
  const share = $('button', 'LINE などで送る', { type: 'button', className: 'local-action request-send', id: `${idp}-share`, hidden: true });
  const sms = $('a', 'SMS で送る', { className: 'local-action', id: `${idp}-sms`, hidden: true });
  const copy = $('button', 'コピーする', { type: 'button', className: 'local-action', id: `${idp}-copy`, hidden: true });
  box.append(show, pre, share, sms, copy, msg);
  let text = '';
  const reset = () => { text = ''; for (const el of [pre, share, sms, copy]) el.hidden = true; msg.textContent = ''; };
  const render = () => {
    try { text = make(); } catch (e) { reset(); msg.textContent = e.message; return false; }
    pre.textContent = text; pre.hidden = false; share.hidden = false; copy.hidden = false;
    const s = smsLink(phone, text);
    sms.hidden = !s; if (s) sms.href = s;
    msg.textContent = '';
    after?.();
    return true;
  };
  show.onclick = render;
  share.onclick = async () => {
    if (!text) return;
    if (navigator.share) {
      try { await navigator.share({ text }); msg.textContent = '共有の画面に渡しました。届いたかは、いつもの相手とのやりとりで。'; return; }
      catch (e) { if (e?.name === 'AbortError') { msg.textContent = 'まだ送っていません。'; return; } }
    }
    copy.onclick();
  };
  copy.onclick = async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); msg.textContent = 'コピーしました。LINE などに貼って送ってください。まだ誰にも送っていません。'; }
    catch { msg.textContent = 'コピーできませんでした。上の文を長押しして選んでください。'; }
  };
  return { reset, render };
}

function telLink(phone, label, id, cls = 'local-action') {
  return $('a', label, { href: `tel:${phone}`, className: cls, id });
}
// 見せる番号は、入れたときの形(090-0000-0000)。掛けるのは数字だけ
const shown = (project, phone) => (typeof project?.site_info?.contact_phone === 'string' && project.site_info.contact_phone.trim()) || phone;

/**
 * 知らせる(遅れます・休みます)。
 * @param {object} project
 * @param {object} o
 * @param {string} o.me        自分の呼び名
 * @param {string} o.today     今日(YYYY-MM-DD)
 * @param {string} o.tomorrow  明日(YYYY-MM-DD)
 * @param {string|null} o.phone 担当の電話
 * @param {(date:string)=>boolean} o.placedOn  その日、この現場に定時の一日が置かれているか
 * @param {(date:string)=>void} o.onYasumi     休みにする(定時の一日を外す)
 * @param {(date:string)=>void} o.onUndoYasumi 取り消す(定時の一日を戻す)
 * @param {(date:string)=>void} o.onKawari     代わりを頼む
 */
export function openShirase(project, o) {
  const box = open('知らせる');
  const info = project.site_info ?? {};
  const to = atena(info.contact);
  box.append($('p', `${project.project_slug} の担当(${to})へ送る文を作ります。送るのはあなた。`));

  const pick = $('div', '', { className: 'shirase-pick' });
  const okure = $('button', '遅れます', { type: 'button', className: 'request-choice', id: 'shirase-okure' });
  okure.append($('small', '着く時刻を添えて'));
  const yasumi = $('button', '休みます', { type: 'button', className: 'request-choice', id: 'shirase-yasumi' });
  yasumi.append($('small', 'そのまま、代わりを頼むへ'));
  pick.append(okure, yasumi);
  const body = $('div', '', { className: 'shirase-body' });
  box.append(pick, body);
  if (o.phone) box.append(telLink(o.phone, `担当へ電話する:${shown(project, o.phone)}`, 'shirase-tel'));

  okure.onclick = () => { pick.hidden = true; renderOkure(body, project, o); };
  yasumi.onclick = () => { pick.hidden = true; renderYasumi(body, project, o); };
  return box;
}

function renderOkure(body, project, o) {
  body.replaceChildren($('h3', '遅れます'));
  const form = $('div', '', { className: 'request-form' });
  const link = mapsLink(project.address ?? project.site_info?.address);
  if (link) {
    form.append($('a', 'Googleマップで到着を見る', { href: link, target: '_blank', rel: 'noopener', className: 'local-action', id: 'okure-maps' }));
  }
  const mapsL = $('label', link ? 'Googleマップの到着' : '着く時刻');
  const mapsIn = $('input', '', { type: 'time', id: 'okure-at', step: 300 });
  mapsL.append(mapsIn);
  const hint = $('p', '', { className: 'request-msg', id: 'okure-yoyuu' });
  const jikoL = $('label', '', { className: 'local-choice' });
  const jiko = $('input', '', { type: 'checkbox', id: 'okure-jiko' });
  jikoL.append(jiko, '事故渋滞');
  const noteL = $('label', '一言(任意)');
  const note = $('textarea', '', { rows: 2, maxLength: 500, id: 'okure-note' });
  noteL.append(note);
  form.append(mapsL, hint, jikoL, noteL);
  body.append(form);
  const showHint = () => {
    hint.textContent = '';
    if (link && mapsIn.value) { try { hint.textContent = `余裕をみて ${yoyuu(mapsIn.value)} ごろ、と書きます。`; } catch { /* 時刻が欠けている */ } }
  };
  const sb = sendBox(body, () => okureText({
    site: project.project_slug, contact: project.site_info?.contact, me: o.me, sign: o.sign, jiko: jiko.checked, note: note.value,
    ...(link ? { mapsAt: mapsIn.value || undefined } : { at: mapsIn.value || undefined }),
  }), { phone: o.phone, idp: 'okure' });
  form.addEventListener('input', () => { showHint(); sb.reset(); });
  form.addEventListener('change', () => { showHint(); sb.reset(); });
}

function renderYasumi(body, project, o) {
  body.replaceChildren($('h3', '休みます'));
  const form = $('div', '', { className: 'request-form' });
  const dayL = $('label', '休む日');
  const day = $('select', '', { id: 'yasumi-date' });
  for (const [v, label] of [[o.today, `今日 ${dayLabel(o.today)}`], [o.tomorrow, `明日 ${dayLabel(o.tomorrow)}`]]) day.append($('option', label, { value: v }));
  if (!o.placedOn(o.today) && o.placedOn(o.tomorrow)) day.value = o.tomorrow;
  dayL.append(day);
  const kawariL = $('label', '', { className: 'local-choice' });
  const kawari = $('input', '', { type: 'checkbox', id: 'yasumi-kawari', checked: true });
  kawariL.append(kawari, '代わりを探していると添える');
  const noteL = $('label', '一言(任意。理由は書かなくていい)');
  const note = $('textarea', '', { rows: 2, maxLength: 500, id: 'yasumi-note' });
  noteL.append(note);
  form.append(dayL, kawariL, noteL);
  body.append(form);

  const next = $('div', '', { className: 'yasumi-next', hidden: true });
  const off = $('button', '', { type: 'button', className: 'local-action', id: 'yasumi-off' });
  const offMsg = $('p', '', { className: 'request-msg', id: 'yasumi-off-msg' }); offMsg.setAttribute('role', 'status');
  const ouen = $('button', '代わりを頼む', { type: 'button', className: 'local-action request-send', id: 'yasumi-kawari-btn' });
  next.append(off, offMsg, ouen);

  let wasPlaced = false;
  const renderOff = () => {
    const d = day.value;
    const placed = o.placedOn(d);
    off.hidden = !placed && !wasPlaced;
    off.textContent = placed ? `${d === o.today ? '今日' : dayLabel(d)}を休みにする(定時の一日を外す)` : '取り消す(定時の一日を戻す)';
  };
  off.onclick = () => {
    const d = day.value;
    try {
      if (o.placedOn(d)) { wasPlaced = true; o.onYasumi(d); offMsg.textContent = '休みにしました。請求書のたたき台にも出ません。'; }
      else { o.onUndoYasumi(d); wasPlaced = false; offMsg.textContent = '戻しました。'; }
    } catch (e) { offMsg.textContent = e.message; }
    renderOff();
  };
  ouen.onclick = () => o.onKawari(day.value);

  const sb = sendBox(body, () => yasumiText({
    site: project.project_slug, date: day.value, today: o.today, contact: project.site_info?.contact, me: o.me, sign: o.sign, kawari: kawari.checked, note: note.value,
  }), { phone: o.phone, idp: 'yasumi', after: () => { next.hidden = false; renderOff(); } });
  body.append(next);
  const changed = () => { sb.reset(); wasPlaced = false; offMsg.textContent = ''; next.hidden = true; };
  form.addEventListener('input', changed);
  form.addEventListener('change', changed);
}

/**
 * いざというとき(人が倒れた・火事)。速報は関係者へ。119 は人を決めて頼む。記録は残さない。
 * @param {'taore'|'kaji'} kind
 * @param {object|null} project
 * @param {object} o
 * @param {string} o.me
 * @param {string|null} o.phone 担当の電話
 */
export function openKinkyu(kind, project, { me = '', sign = [], phone = null } = {}) {
  const box = open(KINKYU[kind], 'kinkyu-dialog');
  const first = $('ol', '', { className: 'kinkyu-steps' });
  const step = (strong, rest = '') => { const li = $('li'); li.append($('strong', strong)); if (rest) li.append($('span', rest)); first.append(li); };
  if (kind === 'kaji') {
    step('まず逃げる。', '自分の身が先。');
    step('大きな声で「火事だ」。', '近くの人に知らせる。');
    step('安全な場所で、119 と速報。');
  } else {
    step('大きな声で、まわりを呼ぶ。');
    step('人を決めて頼む。', '「あなたは 119」「あなたは AED」。一人なら、先に 119。');
    step('速報を関係者へ。', '場所を一言。');
  }
  box.append(first);
  box.append(telLink('119', '119 に電話する', 'kinkyu-119', 'local-action kinkyu-119'));

  const form = $('div', '', { className: 'request-form' });
  const placeL = $('label', '場所(棟・階・区画)');
  const place = $('input', '', { id: 'kinkyu-place', maxLength: 200, placeholder: '例:HB棟 2階 M1070 前' });
  placeL.append(place);
  form.append(placeL);
  let aed = null;
  if (kind === 'taore') {
    const aedL = $('label', '', { className: 'local-choice' });
    aed = $('input', '', { type: 'checkbox', id: 'kinkyu-aed', checked: true });
    aedL.append(aed, 'AED も頼む');
    form.append(aedL);
  }
  box.append(form);
  const sb = sendBox(box, () => sokuhouText({ kind, site: project?.project_slug, place: place.value, aed: aed?.checked ?? false, me, sign }), { phone, idp: 'kinkyu' });
  form.addEventListener('input', sb.reset);
  form.addEventListener('change', sb.reset);
  if (phone) box.append(telLink(phone, `担当へ電話する:${shown(project, phone)}`, 'kinkyu-tel'));

  if (kind === 'kaji') {
    const fuku = $('section', '', { className: 'kinkyu-fuku' });
    fuku.append($('h3', '服に火がついた人'), $('p', FUKU_NI_HI));
    box.append(fuku);
  } else {
    box.append($('p', 'AED の場所は、朝礼や施設の決まりで、前もって見ておく(▲ホームの「そなえ」)。', { className: 'request-msg' }));
  }
  return box;
}
