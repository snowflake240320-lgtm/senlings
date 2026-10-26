import { load } from './storage.js';
import { TRANSFER_FIELDS, makeTransfer, inspectTransfer, acceptTransfer } from './projectTransfer.js';
import { findEnvelope, envelopeToTransfer, envelopeText, makeEnvelope, dayLabel, KINDS } from './envelope.js';
import { placeTeiji, teijiOn, setProjectTeiji, teijiOf } from './work.js';
import { openRequestDialog, siteFromProject, appLink, generalRules } from './requestUI.js';
import { saveLocalRecord, contactPhone, SOS_LABELS } from './localRecords.js';
import { savePhotoMeta, buildPhotoFilename } from './photo.js';
import { SETTINGS_KEYS, getAllSettings, saveSettingsFromForm, getSetting } from './settings.js';
import { readNakama, HOO_TRADES } from './nakama.js';

const $ = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });
let dialog;
function panel(title) {
  dialog?.remove();
  dialog = $('dialog', '', { className: 'local-dialog', id: 'local-dialog' });
  dialog.setAttribute('aria-label', title);
  const head = $('header'), heading = $('h2', title);
  const close = $('button', '閉じる', { className: 'local-close', type: 'button' });
  close.onclick = () => dialog.close(); head.append(heading, close);
  dialog.append(head); document.body.append(dialog); dialog.showModal();
  return dialog;
}
function paragraph(parent, text) { const el = $('p', text); parent.append(el); return el; }
function status(parent) { const el = paragraph(parent, ''); el.setAttribute('role', 'status'); return el; }
function field(parent, label, tag = 'input', attrs = {}) {
  const wrapper = $('label', label), input = $(tag, '', attrs); wrapper.append(input); parent.append(wrapper); return input;
}
function action(parent, text, fn, id) {
  const button = $('button', text, { type: 'button', className: 'local-action', id: id ?? '' });
  button.onclick = fn; parent.append(button); return button;
}
function download(name, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = $('a', '', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function values(parent, packet, { showName = true, idLabel = '送り手の物件ID', showId = true } = {}) {
  if (showName) paragraph(parent, `現場：${packet.project.name}`);
  if (showId) paragraph(parent, `${idLabel}：${packet.source_project_id} ／ 版：${packet.revision}`);
  for (const [key, label] of TRANSFER_FIELDS) if (Object.hasOwn(packet.project, key)) {
    const block = $('section'); block.append($('h3', label), $('p', packet.project[key] || '（空欄）')); parent.append(block);
  }
}

// 受け取る(郵便受け)。LINE で届いた依頼は、文のリンクから入る(コピー貼り付けは無し。10-26 船長)。
// 届いた依頼は、要点と五択だけ(二段構え)。中身の全部と現場名は五択の下に畳む。
// 封筒が無い文でも、現場名を決めれば、その文を「届いた連絡」として現場を立てられる。文とファイル(物件情報 JSON)は、設定の「ファイルで受け取る」から。
// 受けるかどうか、その日に置くかどうかは、受けた人が決める。返事は LINE で、いつもどおりに。
export function receiveProject(onSaved, { text: arrived = '', file: fileMode = false } = {}) {
  const mode = arrived ? 'arrived' : 'file';
  void fileMode;
  const box = panel(mode === 'file' ? 'ファイルで受け取る' : '受け取る');
  const lead = paragraph(box, mode === 'arrived' ? 'リンクで届いた依頼です。受けるかどうかを選んでください。選ぶまで、何も残しません。'
    : '物件情報ファイル(JSON)か、届いた文を入れます。確かめてから、自分の現場に加えます。');
  const inputWrap = $('label', '届いた文'), input = $('textarea', '', { rows: 5, id: 'handoff-input', maxLength: 128000 });
  inputWrap.append(input); box.append(inputWrap);
  let file = null;
  if (mode === 'file') file = field(box, '物件情報ファイル（JSON）', 'input', { type: 'file', accept: '.json,application/json', id: 'handoff-file' });
  const message = status(box), preview = $('div', '', { id: 'handoff-preview' });
  box.append(preview);
  const after = $('div', '', { id: 'handoff-after' });
  let confirmed = null, packetJson = null, envelope = null, fileGeneration = 0, slugInput = null, detail = null;
  // 受けるかどうかは、受けた人が決める(受注の前の五択。10-25 船長)。封筒のときだけ出す
  const choices = $('div', '', { className: 'request-choices', id: 'handoff-choices', hidden: true });
  function doAccept() {
    if (!confirmed || confirmed !== input.value || !packetJson) return null;
    const result = acceptTransfer(packetJson, undefined, undefined, { slug: slugInput?.value });
    if (envelope && result.action !== 'received' && envelope.site.start && envelope.site.end) setProjectTeiji(result.project_id, envelope.site.start, envelope.site.end);
    return result;
  }
  const accept = action(box, '確認して受け取る', () => {
    if (!confirmed || confirmed !== input.value || !packetJson) return;
    try {
      const result = doAccept();
      message.textContent = result.action === 'received' ? 'この版は受取済みです。現場は増やしていません。' : 'この端末の現場に保存しました。返事は、いつもの相手とのやりとりで。';
      accept.disabled = true;
      if (envelope?.work_date) offerDay(result.project_id, envelope.work_date);
      onSaved();
    } catch (error) { message.textContent = error.message; }
  }, 'handoff-accept');
  accept.disabled = true;
  box.append(choices, after);

  // 返事の下書き。送るのは人(共有の画面へ)。既読・催促は持たない。何も保存しない
  function reply(title, text, id, { keep = false, note = '' } = {}) {
    if (!keep) after.replaceChildren();
    after.append($('h3', title));
    if (note) paragraph(after, note);
    const area = $('textarea', '', { rows: 6, value: text, id: `reply-${id}`, className: 'reply-text' });
    const w = $('label', '送る文(ここで直せます)'); w.append(area); after.append(w);
    const msg = status(after);
    action(after, 'LINE などで送る', async () => {
      if (navigator.share) { try { await navigator.share({ text: area.value }); msg.textContent = '共有の画面に渡しました。'; return; } catch (e) { if (e?.name === 'AbortError') { msg.textContent = 'まだ送っていません。'; return; } } }
      try { await navigator.clipboard.writeText(area.value); msg.textContent = 'コピーしました。LINE などに貼って送ってください。'; } catch { msg.textContent = '文を長押しして選んでください。'; }
    }, `reply-send-${id}`);
  }
  // 頼んでくれた人へのあいさつ(Reachability。10-25 船長)。紹介の記録も点数も持たず、つながりは人と人のやりとりに残す。
  // あいさつは「自分に頼んでくれた人」へ。間の人を越えて、その先の依頼主へは行かない(越えない。縦を飛び越えない)。
  function greet(env, me) {
    let trades = '';
    try { trades = readNakama().trades.map(k => HOO_TRADES[k]?.label).filter(Boolean).join('・'); } catch { trades = ''; }
    const lines = [`${env.from ? `${env.from}さん` : 'ご担当の方'}`,
      `${me ? `${me}です。` : ''}${trades ? `${trades}をやっています。` : ''}`.trim(),
      `${env.work_date ? `${dayLabel(env.work_date)}、` : ''}${env.site.name}、伺います。`,
      '当日は、どうぞよろしくお願いします。'].filter(Boolean);
    reply('頼んでくれた人へ、あいさつ', lines.join('\n'), 'greet', { keep: true, note: `受けたことを、${env.from ? `${env.from}さん` : '頼んでくれた人'}へ伝えます。このやりとりが、そのまま「この現場に呼ばれた」しるしになります。` });
  }
  function renderChoices() {
    choices.replaceChildren();
    if (!envelope) { choices.hidden = true; accept.hidden = false; return; }
    choices.hidden = false; accept.hidden = true;
    const env = envelope, me = getSetting(SETTINGS_KEYS.USER_NAME) ?? '';
    const day = env.work_date ? `${dayLabel(env.work_date)} の` : '';
    const to = env.from ? `${env.from}さん\n` : '';
    choices.append($('p', 'どうしますか。選ぶまで、何も残しません。', { className: 'request-choices-lead' }));
    const pick = (text, sub, id, fn) => {
      const b = $('button', '', { type: 'button', className: 'request-choice', id: `choice-${id}` });
      b.append($('span', text), $('small', sub)); b.onclick = () => { try { fn(); } catch (e) { message.textContent = e.message; } }; choices.append(b);
    };
    pick('自分で受ける', '現場を加える。その日に置くかは次に選ぶ', 'self', () => {
      const r = doAccept(); if (!r) return;
      message.textContent = r.action === 'received' ? 'この版は受取済みです。' : 'この端末の現場に保存しました。';
      choices.hidden = true; onSaved(); after.replaceChildren();
      greet(env, me);
      if (env.work_date) offerDay(r.project_id, env.work_date, { keep: true });
    });
    pick('協力して受ける', '現場を加えて、手伝ってくれる人に声をかける', 'together', () => {
      const r = doAccept(); if (!r) return;
      choices.hidden = true; onSaved(); after.replaceChildren();
      message.textContent = 'この端末の現場に保存しました。';
      greet(env, me);
      if (env.work_date) offerDay(r.project_id, env.work_date, { keep: true });
      const project = load().projects.find(p => p.project_id === r.project_id);
      action(after, '手伝ってくれる人に声をかける(応援を呼ぶ)', () =>
        openRequestDialog({ kind: 'ouen', from: me, site: siteFromProject(project, teijiOf(project)), workDate: env.work_date }), 'handoff-ouen');
    });
    pick('時期を調整する', 'その日は難しいと返す(現場は加えない)', 'later', () =>
      reply('時期を調整する', `${to}${day}${env.site.name} の件、ありがとうございます。その日は難しいです。\n○/○ からなら行けます。`, 'later'));
    // つなぐ=自分の名前で頼み直す。受けた人の依頼主はあなたになり、あいさつも返事もあなたへ届く(越えない)
    pick('ほかの人へつなぐ', 'あなたの名前で、ほかの人に頼み直す', 'pass', () => {
      const again = makeEnvelope({ kind: 'ouen', from: me, date: env.date, work_date: env.work_date ?? '', note: env.note ?? '',
        site: { ...env.site, revision: Math.max(env.site.revision, Math.floor(Date.now() / 1000)) } });
      reply('ほかの人へつなぐ', envelopeText(again, { link: appLink() }), 'pass',
        { note: me ? '' : '設定で呼び名を入れると、相手があなたに返事できます。' });
    });
    pick('受けない', '見送ると返す(何も残さない)', 'decline', () =>
      reply('受けない', `${to}${day}${env.site.name} の件、ありがとうございます。今回は見送らせてください。また声をかけてもらえると嬉しいです。`, 'decline'));
    if (detail) choices.append(detail);
    choices.append(generalRules());
  }
  // その日に置くかは、受けた人が決める(押したときだけ)
  function offerDay(projectId, date, { keep = false } = {}) {
    if (!keep) after.replaceChildren();
    const other = teijiOn(load(), date);
    if (other?.project_id === projectId) { paragraph(after, `${dayLabel(date)} は、もうこの現場です。`); return; }
    const put = action(after, `${dayLabel(date)} を、この現場の日に${other ? '置き直す' : 'する'}`, () => {
      try { placeTeiji(projectId, date); put.disabled = true; message.textContent = `${dayLabel(date)} に置きました。前の晩の準備にも出ます。`; onSaved(); }
      catch (error) { message.textContent = error.message; }
    }, 'handoff-place-day');
  }
  const inspect = action(box, '内容を確認する', () => {
    confirmed = null; packetJson = null; envelope = null; accept.disabled = true; accept.hidden = false; choices.hidden = true; preview.replaceChildren(); after.replaceChildren(); slugInput = null; detail = null;
    try {
      const text = input.value;
      let plain = false;
      envelope = findEnvelope(text);
      if (envelope) packetJson = JSON.stringify(envelopeToTransfer(envelope, text));
      else if (text.trim().startsWith('{')) packetJson = text;
      else if (text.trim()) {
        // 封筒の行が無い文。現場名を決めれば、その文を届いた連絡として現場を立てる
        plain = true;
        const first = text.trim().split('\n')[0].replace(/^[【\[].*?[】\]]\s*/, '').slice(0, 200) || '届いた現場';
        packetJson = JSON.stringify({ format: 'senlings.project-handoff', schema_version: 1, source_project_id: `text:${crypto.randomUUID()}`, revision: 1, project: { name: first, raw: text.slice(0, 20000) } });
      } else throw new Error('届いた文を貼ってください。');
      const plan = inspectTransfer(packetJson);
      // 封筒なら、上には要点だけ(何を・いつ・どこ・一言)。中身の全部と現場名は、五択の下に畳む
      const where = envelope ? (plan.action === 'received' ? preview : (detail = $('details', '', { className: 'handoff-detail', id: 'handoff-detail' }))) : preview;
      if (envelope) {
        const head = $('div', '', { className: 'handoff-head' });
        head.append($('p', `${KINDS[envelope.kind]}${envelope.from ? `(${envelope.from}より)` : ''}`, { className: 'handoff-head-kind' }));
        const when = [envelope.work_date ? dayLabel(envelope.work_date) : '', envelope.site.start ? `${envelope.site.start.replace(/^0/, '')}〜${envelope.site.end.replace(/^0/, '')}` : ''].filter(Boolean).join(' ');
        if (when) head.append($('p', when, { className: 'handoff-head-when' }));
        head.append($('p', plan.action === 'update' ? plan.current_slug : envelope.site.name, { className: 'handoff-head-site' }));
        if (envelope.note) head.append($('p', envelope.note, { className: 'handoff-head-note' }));
        preview.append(head);
        if (detail) detail.append($('summary', plan.action === 'add' ? '中身を全部見る・現場名を変える' : '中身を全部見る'));
      }
      if (plain) paragraph(preview, 'Senlings 用の行がない文です。この文を「届いた連絡」として残して、現場を立てます。');
      if (plan.action === 'add') {
        slugInput = field(where, 'この端末での現場名（そのままでも、自分の呼び名でも）', 'input', { value: plan.packet.project.name, maxLength: 200, id: 'handoff-slug' });
        values(where, plan.packet, { showName: false, showId: !envelope && !plain });
      } else if (plan.action === 'update') {
        paragraph(where, `現場名はそのまま：${plan.current_slug}` + (plan.current_slug !== plan.packet.project.name ? `（送り手の現場名：${plan.packet.project.name}）` : ''));
        values(where, plan.packet, { showName: false, showId: !envelope });
      } else values(where, plan.packet, { showId: !envelope });
      message.textContent = plan.action === 'received' ? '同じ版を受取済みです。'
        : plan.action === 'update' ? (envelope ? '知っている現場の、新しい知らせです。' : '知っている現場の、新しい知らせです。表示した項目を現場へ反映します。現場名・以前の原本・自分の記録はそのまま残ります。')
        : envelope ? '' : '新しい現場として加えます。この端末に置くだけで、相手には何も送られません。';
      accept.textContent = plan.action === 'update' ? '確認してこの版を反映する' : '確認して受け取る';
      confirmed = input.value; accept.disabled = plan.action === 'received';
      if (plan.action !== 'received') renderChoices(); else { choices.hidden = true; accept.hidden = !!envelope; }
      if (plan.action === 'received' && envelope?.work_date) offerDay(plan.project_id, envelope.work_date);
    } catch (error) { message.textContent = error.message; }
  }, 'handoff-inspect');
  box.insertBefore(inspect, message);
  input.oninput = () => { fileGeneration++; confirmed = null; packetJson = null; envelope = null; slugInput = null; detail = null; accept.disabled = true; accept.hidden = mode !== 'file'; choices.hidden = true; preview.replaceChildren(); after.replaceChildren(); message.textContent = ''; };
  // リンクで届いたときは、要点と五択だけ。欄も確認の手も出さない
  inputWrap.hidden = mode !== 'file'; inspect.hidden = mode !== 'file'; accept.hidden = mode !== 'file';
  void lead;
  if (file) file.onchange = async () => {
    const ticket = ++fileGeneration;
    confirmed = null; slugInput = null; accept.disabled = true; preview.replaceChildren();
    try {
      if (!file.files[0]) return;
      if (file.files[0].size > 128000) throw new Error('128KB以内のファイルを選んでください。');
      const text = await file.files[0].text();
      if (ticket !== fileGeneration) return;
      input.value = text; message.textContent = '読み込みました。「内容を確認する」で確認してください。';
    } catch (error) { if (ticket === fileGeneration) message.textContent = error.message; }
  };
  // リンクで届いたときは、そのまま中身と五択まで
  if (arrived) { input.value = arrived; input.oninput(); inspect.onclick(); }
  return box;
}

export function giveProject(project) {
  const box = panel('物件情報を渡す');
  paragraph(box, '現場名と、選んだ物件情報だけを書き出します。自分のメモ・写真・勤怠・請求は含みません。渡す相手はファイルを渡すときに選べます。');
  const revision = field(box, '版（内容を訂正して渡すときは増やす）', 'input', { type: 'number', min: '1', step: '1', value: '1', id: 'handoff-revision' });
  const selected = [];
  for (const [key, label] of TRANSFER_FIELDS) {
    const value = key === 'address' ? project.address : project.site_info?.[key];
    if (typeof value !== 'string' || !value) continue;
    const wrapper = $('label', '', { className: 'local-choice' });
    const checkbox = $('input', '', { type: 'checkbox', value: key, checked: false });
    wrapper.append(checkbox, $('span', label)); box.append(wrapper); selected.push(checkbox);
  }
  const message = status(box), preview = $('div', '', { id: 'handoff-out-preview' }); box.append(preview);
  let packet = null;
  const save = action(box, 'この内容をファイルにする', () => {
    if (!packet) return;
    load(); download(`senlings-property-v${packet.revision}.json`, JSON.stringify(packet, null, 2));
    message.textContent = 'ダウンロードを開始しました。相手への送信・到達はまだ確認していません。';
  }, 'handoff-download'); save.disabled = true;
  const review = action(box, '渡す内容を確認する', () => {
    preview.replaceChildren(); save.disabled = true; packet = null;
    try {
      packet = makeTransfer(project, selected.filter(el => el.checked).map(el => el.value), Number(revision.value));
      values(preview, packet, { idLabel: '照合用ID（相手が版を見分けるため）' }); save.disabled = false; message.textContent = 'この内容を確認して書き出せます。';
    } catch (error) { message.textContent = error.message; }
  }, 'handoff-review'); box.insertBefore(review, preview);
  for (const input of [revision, ...selected]) input.oninput = () => { packet = null; preview.replaceChildren(); save.disabled = true; };
}

export function writeMemo(project) {
  const box = panel('自分のメモ');
  paragraph(box, `${project.project_slug} ／ 自分のための記録です。共有するまでは、この端末だけに残ります。`);
  const input = field(box, '工夫したこと・覚えておきたいこと', 'textarea', { rows: 6, maxLength: 10000, id: 'private-memo' });
  const message = status(box), id = crypto.randomUUID();
  const button = action(box, 'この端末に保存する', () => {
    try {
      saveLocalRecord({ id, project_id: project.project_id, kind: 'memo', text: input.value, created_at: Date.now() });
      message.textContent = '保存しました。仕舞いの「自分の記録を見返す」で開けます。'; button.disabled = true; input.readOnly = true;
    } catch (error) { message.textContent = error.message; }
  }, 'memo-save');
}

async function compactPhoto(file) {
  if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error('20MB以内の画像を選んでください。');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('この画像を読み込めません。JPEGやPNGなど、この端末で表示できる写真を選んでください。'); }
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL('image/jpeg', .72);
    if (data.length > 700000) throw new Error('縮小後の画像が大きすぎます。小さい画像を選んでください。');
    return data;
  } finally { URL.revokeObjectURL(url); }
}

export function takePhoto(project) {
  const box = panel('写真を残す');
  paragraph(box, '簡易保存：長辺1280pxまでの縮小写真を、この端末に保存します。元の写真は端末の写真アプリなどでも保管してください。ブラウザのデータを消すと、この中の記録も消えます。');
  const input = field(box, '撮影・写真を選ぶ', 'input', { type: 'file', accept: 'image/*', id: 'private-photo' });
  const memo = field(box, 'ひとこと（任意）', 'textarea', { rows: 2, maxLength: 100, id: 'photo-caption' });
  const preview = $('img', '', { alt: '保存前の縮小写真', className: 'local-photo', hidden: true }); box.append(preview);
  const message = status(box); let thumbnail = null, generation = 0;
  const button = action(box, '縮小写真を保存する', () => {
    if (!thumbnail) return;
    try {
      const data = load();
      const size = data.photos.reduce((n, photo) => n + (photo.thumbnail?.length ?? 0), 0);
      if (size + thumbnail.length > 3000000) throw new Error('簡易写真保存の上限です。写真を端末へ書き出して保管してください。');
      const { filename, takenAt } = buildPhotoFilename(project.project_id);
      savePhotoMeta({ id: crypto.randomUUID(), project_id: project.project_id, filename, atmosphere: memo.value,
        thumbnail, taken_at: takenAt, storage_kind: 'local_reduced', visibility: 'private' });
      button.disabled = true; input.disabled = true; memo.readOnly = true;
      message.textContent = '縮小写真を保存しました。仕舞いから見返せます。';
    } catch (error) { message.textContent = error.message; }
  }, 'photo-save'); button.disabled = true;
  input.onchange = async () => {
    const ticket = ++generation; thumbnail = null; button.disabled = true; preview.hidden = true;
    try {
      if (!input.files[0]) return;
      message.textContent = '写真を準備しています。'; const result = await compactPhoto(input.files[0]);
      if (ticket !== generation) return;
      thumbnail = result; preview.src = result; preview.hidden = false; button.disabled = false;
      message.textContent = 'まだ保存していません。写真を確認して保存してください。';
    } catch (error) { if (ticket === generation) message.textContent = `保存していません。${error.message}`; }
  };
}

export function sosText(project, record, label) {
  // 相手に貼って送る文。本人向けの注意書き(到達未確認)は画面側に出し、ここには混ぜない。
  return `${project.project_slug}\n${label}\n${record.text}\n記録日時：${new Date(record.created_at).toLocaleString('ja-JP')}`;
}
export async function copyText(text, target) {
  try { await navigator.clipboard.writeText(text); target.textContent = 'コピーしました。連絡先のアプリに貼り付け、内容を確認して送ってください。到達は未確認です。'; }
  catch { target.textContent = 'コピーできませんでした。表示した文章を選択してコピーするか、テキストを書き出してください。'; }
}
export function exportText(text) { load(); download('senlings-record.txt', text, 'text/plain;charset=utf-8'); }

export function reviewRecords() {
  const box = panel('自分の記録を見返す'), data = load();
  paragraph(box, '記録はこの端末にあります。渡したいものだけ、個別に書き出せます。');
  const records = [
    ...(data.local_records ?? []).map(r => ({ ...r, kind: r.personal_note ? 'return' : r.kind, time: r.created_at })), // 帰りの一言も帰還の記録
    ...data.photos.filter(p => !p.deleted).map(p => ({ ...p, kind: 'photo', time: p.taken_at })),
    ...data.work_sessions.filter(s => s.personal_note).map(s => ({ ...s, kind: 'return', time: s.check_out_at, text: s.personal_note.text })),
  ].sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  if (!records.length) paragraph(box, 'メモ・写真・帰還時の記録はまだありません。');
  for (const record of records) {
    const card = $('section', '', { className: 'local-record' });
    const name = data.projects.find(p => p.project_id === record.project_id)?.project_slug ?? record.project_id;
    const kind = { memo: 'メモ', sos: 'SOS・送信未確認', photo: '写真', return: '帰還の記録' }[record.kind];
    card.append($('h3', `${name} ／ ${kind}`), $('p', record.time ? new Date(record.time).toLocaleString('ja-JP') : '日時なし'));
    let content = record.text ?? record.atmosphere ?? '';
    if (record.personal_note) {
      const note = record.personal_note;
      content = [note.mood === 'positive' ? 'また入りたい' : note.mood === 'conditional' ? '複雑な気持ち' : '',
        (note.categories ?? []).map(key => ({ anzen: '危なかったこと', hinshitsu: '仕上がり・納まり', koutei: '段取り・待ち時間', genka: '追加・材料・経費' }[key] ?? key)).join('、'), content].filter(Boolean).join('\n');
    }
    if (record.kind === 'sos') content = `${SOS_LABELS[record.field_key] ?? '困りごと'}\n${content}`;
    card.append($('p', content));
    if (record.kind === 'photo' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(record.thumbnail ?? '')) {
      card.append($('img', '', { src: record.thumbnail, alt: record.atmosphere || '保存した写真', className: 'local-photo' }));
      action(card, 'この縮小写真を書き出す', () => {
        load(); const a = $('a', '', { href: record.thumbnail, download: record.filename || 'senlings-photo.jpg' }); document.body.append(a); a.click(); a.remove();
      });
    } else action(card, 'この記録だけテキストにする', () => exportText(`${name}\n${kind}\n${content}`));
    box.append(card);
  }
}

export function showContact(project) {
  const box = panel('担当者へ確認する');
  if (!project) { paragraph(box, '受け取った連絡にある担当者へ、現場名と場所を確認してください。連絡を受け取ったら「現場を追加する」に残せます。'); return; }
  paragraph(box, project.site_info?.contact || 'この現場の担当者は未登録です。');
  const phone = contactPhone(project);
  if (phone) box.append($('a', `電話する：${phone}`, { href: `tel:${phone}`, className: 'local-action' }));
}

export function editSettings() {
  const box = panel('請求書・口座設定'), settings = getAllSettings(), fields = {};
  paragraph(box, 'この端末の設定として保存します。保存済みの請求書下書きは変更しません。');
  const add = (parent, name, label) => {
    const key = SETTINGS_KEYS[name];
    fields[key] = field(parent, label, 'input', { value: settings[key] ?? '', maxLength: 500, id: `setting-${name.toLowerCase()}` });
  };
  // 今回使う口は三つ(Excel・CSVに出る)。口座・登録番号は保管のみなので畳んでおく。旧UIで入れた値は読める。
  for (const [name, label] of [['USER_NAME', 'お名前（請求書に出ます）'], ['WORK_UNIT_PRICE', '1人工の単価（円）'], ['TAX_RATE', '税率（例：0.10）']]) add(box, name, label);
  const more = $('details', '', { className: 'add-site-more', id: 'settings-more' });
  more.append($('summary', '口座・登録番号も入れる（保管のみ）'));
  for (const [name, label] of [['REGISTRATED_NUMBER', '登録番号'], ['BANK_NAME', '銀行名'], ['BANK_BRANCH', '支店名'],
    ['BANK_ACCOUNT_TYPE', '口座種別'], ['BANK_ACCOUNT_NUMBER', '口座番号'], ['BANK_ACCOUNT_HOLDER', '口座名義']]) add(more, name, label);
  paragraph(more, '口座情報はこの端末での保管用です。いまのExcelテンプレートには自動では載りません。');
  box.append(more);
  const message = status(box);
  action(box, '設定を保存する', () => {
    try { saveSettingsFromForm(Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value]))); message.textContent = '保存しました。'; }
    catch (error) { message.textContent = error.message; }
  }, 'settings-save');
}
