// requestUI.js — 依頼の一枚(頼む側)。職人の「応援を呼ぶ」と、元請けの「現場の依頼」で同じ部品を使う。
// 送るのは人。Senlings は文を下書きして、共有の画面(LINE など)へ渡すだけ。既読も催促も持たない。
import { makeEnvelope, envelopeText, envelopeLink, SITE_FIELDS, KINDS, fnv, TOKEN_MARK } from './envelope.js';

const $ = (tag, text = '', attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });

function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 迷ったら、一般論(10-25 船長)。個別の判断ではない。決めるのは当人で、迷いが大きいときは専門家へ
export const GENERAL_RULES = Object.freeze([
  ['頼むのは、自分に頼んだ人と、自分が頼む人のあいだだけ', '仕事の依頼は一段ずつ。間の人を越えて、その先の人へ直接頼まない。返事やあいさつも、自分に頼んでくれた人へ。'],
  ['やり方・時間・配置の指示は、雇っている会社から', '請負では、作業の指示を出すのは請け負った会社。元請けが下の職人へ直接指示すると、偽装請負になり得る(職業安定法44条)。建設の仕事は派遣も禁止(労働者派遣法4条)。'],
  ['安全と連絡調整は、別', '駐車・搬入・停電・朝礼・危ない場所などのお知らせは、現場のみんなに向けてよい(元方事業者の安全の役目)。'],
  ['一人親方を、雇い人のように扱わない', '時間ややり方を細かく管理すると、請負ではなく雇用と見られる方向に寄る。'],
  ['単価や請求は、契約の相手とだけ', '自分の単価・請求・勤怠は、依頼の文に乗せない。Senlings も乗せない。'],
]);

export function generalRules(lead = '迷ったら(一般論)') {
  const d = $('details', '', { className: 'mayottara' });
  d.append($('summary', lead));
  const ul = $('ul');
  for (const [head, body] of GENERAL_RULES) { const li = $('li'); li.append($('strong', head), $('span', body)); ul.append(li); }
  d.append(ul, $('p', '一般論です。個別の判断は、契約の相手と決めてください。迷いが大きいときは、専門家(社労士・弁護士)へ。', { className: 'mayottara-note' }));
  return d;
}

export function appLink(loc = typeof location === 'undefined' ? null : location) {
  return loc ? `${loc.origin}/?openExternalBrowser=1` : '';
}

/**
 * 依頼の一枚を container に描く。
 * @param {HTMLElement} container
 * @param {object} o
 * @param {'ouen'|'genba'} o.kind  職人の応援=ouen、元請けの依頼=genba
 * @param {string} [o.from]  差出人(呼び名)
 * @param {object} [o.site]  はじめから入れておく現場(name, start, end, address …, source_id, revision)
 * @param {string} [o.workDate]  日にち(無ければ明日)
 * @param {function} [o.onFrom]  差出人を覚えておくとき
 */
export function renderComposer(container, { kind, from = '', site = {}, workDate, onFrom = () => {}, link = appLink() } = {}) {
  container.replaceChildren();
  const form = $('div', '', { className: 'request-form' });
  const field = (label, attrs = {}, tag = 'input') => {
    const w = $('label', label); const el = $(tag, '', attrs); w.append(el); form.append(w); return el;
  };
  const fromIn = field(kind === 'ouen' ? 'あなたの呼び名' : '差出人(会社・お名前)', { value: from, maxLength: 100, id: 'req-from', autocomplete: 'name' });
  const dateIn = field('いつ来てほしいか', { type: 'date', value: workDate ?? localDate(Date.now() + 86400000), id: 'req-date' });
  const nameIn = field('現場名', { value: site.name ?? '', maxLength: 200, id: 'req-name' });
  const times = $('div', '', { className: 'request-times' });
  const startIn = $('input', '', { type: 'time', value: site.start ?? '08:00', id: 'req-start', step: 900 });
  const endIn = $('input', '', { type: 'time', value: site.end ?? '17:00', id: 'req-end', step: 900 });
  startIn.setAttribute('aria-label', '始業'); endIn.setAttribute('aria-label', '終業');
  const tl = $('label', '時間'); times.append(startIn, $('span', '〜'), endIn); tl.append(times); form.append(tl);
  const noteIn = field('一言(任意)', { rows: 2, maxLength: 2000, id: 'req-note', placeholder: kind === 'ouen' ? '例:ボード貼りの手が足りません' : '例:初日は 8:20 の朝礼から' }, 'textarea');
  const more = $('details', '', { className: 'request-more' });
  more.append($('summary', '住所・朝礼・駐車などを入れる'));
  const siteIns = {};
  for (const [key, label] of SITE_FIELDS) {
    const w = $('label', label);
    const el = $(key === 'address' || key === 'contact' || key === 'contact_phone' ? 'input' : 'textarea', '', { maxLength: 2000, id: `req-${key}`, value: site[key] ?? '' });
    if (el.tagName === 'TEXTAREA') el.rows = 2;
    if (key === 'contact_phone') { el.type = 'tel'; el.inputMode = 'tel'; }
    w.append(el); more.append(w); siteIns[key] = el;
  }
  if (SITE_FIELDS.some(([k]) => site[k])) more.open = true;
  form.append(more);
  container.append(form);

  const msg = $('p', '', { className: 'request-msg' }); msg.setAttribute('role', 'status');
  const preview = $('pre', '', { className: 'request-preview', id: 'req-preview', hidden: true });
  const make = $('button', '文を見る', { type: 'button', className: 'local-action', id: 'req-make' });
  const share = $('button', 'LINE などで送る', { type: 'button', className: 'local-action request-send', id: 'req-share', hidden: true });
  const copy = $('button', 'コピーする', { type: 'button', className: 'local-action', id: 'req-copy', hidden: true });
  container.append(make, preview, share, copy, msg, generalRules());

  let text = '';
  const reset = () => { text = ''; preview.hidden = true; share.hidden = true; copy.hidden = true; msg.textContent = ''; };
  form.addEventListener('input', reset);

  make.onclick = async () => {
    try {
      // 同じ現場は同じ照合用ID(受けた側では、新しい版として上書きされ、表札は変わらない)。版は送るたびに新しく。
      const s = { ...site, name: nameIn.value, start: startIn.value, end: endIn.value, revision: Math.floor(Date.now() / 1000) };
      for (const [key] of SITE_FIELDS) s[key] = siteIns[key].value;
      const env = makeEnvelope({ kind, from: fromIn.value, date: localDate(Date.now()), work_date: dateIn.value, note: noteIn.value, site: s });
      // リンクには依頼そのものが入る(押せば、その現場の依頼が開く)
      text = envelopeText(env, { link: await envelopeLink(env, link) });
      // 見る欄では、Senlings 用の一行を畳む(送る文には、そのまま入る)
      preview.textContent = text.replace(/〔Senlings〕\S+/, `${TOKEN_MARK}(Senlings 用の短い一行)`).replace(/(Senlings で開く → \S+?)#r=\S+/, '$1(この依頼が開くリンク)'); preview.hidden = false;
      share.hidden = false; copy.hidden = false;
      msg.textContent = 'この文で送ります。直すときは上の欄を直して、もう一度「文を見る」。';
      onFrom(fromIn.value.trim());
    } catch (e) { msg.textContent = e.message; }
  };
  share.onclick = async () => {
    if (!text) return;
    if (navigator.share) {
      try { await navigator.share({ text }); msg.textContent = '共有の画面に渡しました。届いたか、返事は、いつもの相手とのやりとりで。'; return; }
      catch (e) { if (e?.name === 'AbortError') { msg.textContent = 'まだ送っていません。'; return; } }
    }
    copy.onclick();
  };
  copy.onclick = async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); msg.textContent = 'コピーしました。LINE などに貼って送ってください。まだ誰にも送っていません。'; }
    catch { msg.textContent = 'コピーできませんでした。上の文を長押しして選んでください。'; }
  };
  return { make };
}

export { KINDS };

// Senlings の中で開く(▲ホームの「応援を呼ぶ」、申し送りの「この現場に人を頼む」)。
let dialog;
export function openRequestDialog(opts) {
  dialog?.remove();
  dialog = $('dialog', '', { className: 'local-dialog request-dialog', id: 'local-dialog' });
  dialog.setAttribute('aria-label', opts.kind === 'ouen' ? '応援を呼ぶ' : '現場を依頼する');
  const head = $('header'); const close = $('button', '閉じる', { className: 'local-close', type: 'button' });
  close.onclick = () => dialog.close();
  head.append($('h2', opts.kind === 'ouen' ? '応援を呼ぶ' : '現場を依頼する'), close);
  dialog.append(head);
  dialog.append($('p', opts.kind === 'ouen' ? '頼みたい人に、LINE などで送る文を作ります。送るのはあなた。相手が Senlings を使っていなくても、文だけで伝わります。' : '職人に送る文を作ります。'));
  const body = $('div'); dialog.append(body);
  document.body.append(dialog); dialog.showModal();
  renderComposer(body, opts);
  if (opts.extra) dialog.append(opts.extra);
  return dialog;
}

/** 自分の現場から、依頼の一枚に入れる中身を作る(自分のメモ・写真・勤怠・請求・届いた連絡の原文は入れない)。 */
export function siteFromProject(project, teiji) {
  if (!project) return {};
  const id = project.handoff_source?.source_project_id ?? project.project_id;
  const s = { name: project.project_slug, source_id: /^[A-Za-z0-9_.:-]{1,200}$/.test(id) ? id : `n${fnv(id)}` };
  if (teiji) { s.start = teiji.start; s.end = teiji.end; }
  if (project.address) s.address = project.address;
  for (const [key] of SITE_FIELDS) if (key !== 'address' && typeof project.site_info?.[key] === 'string' && project.site_info[key]) s[key] = project.site_info[key];
  return s;
}
