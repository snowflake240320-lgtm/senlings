// homeScreen.js — ホーム画面に置く(2026-10-25 船長の決め:入口は LINE、家はホーム画面)
//
// iPhone は、サイトが自分でホーム画面に置くことを許していない。だから職人の指は Safari で 3〜4 回。
// 減らせないので、迷わない一枚にする。初日に船長が横で見る手順書でもある(手渡し。職人の指は 0 回)。
// - ホーム画面から開いているときは、何も出さない
// - 「あとで」を押したら、もう出さない(▲ホームの設定から開ける)。催促しない
// - iPhone の版で手順が違う(iOS 26 からは「…」が先)ので、見分けて出し分ける
// - LINE の中では置けない。Safari で開いてもらう
// - Android は一押し(ブラウザが置かせてくれるとき)
// この好みは端末の中だけ(localStorage)。職人の記録(senlings_v0)には触れない。

export const LATER_KEY = 'senlings_homescreen_later';

export function homeScreenState({ ua, standalone, installPrompt = null } = {}) {
  ua ??= typeof navigator === 'undefined' ? '' : navigator.userAgent;
  standalone ??= typeof navigator !== 'undefined' && (navigator.standalone === true ||
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches));
  if (standalone) return { kind: 'home' };
  const inLine = /\bLine\//i.test(ua);
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1);
  if (ios) {
    const m = ua.match(/OS (\d+)_/);
    const major = m ? Number(m[1]) : 0;
    return { kind: 'ios', major, inLine, otherBrowser: /CriOS|FxiOS|EdgiOS|OPT\//.test(ua), compact: major >= 26 };
  }
  if (/Android/.test(ua)) return { kind: 'android', inLine, prompt: !!installPrompt };
  return { kind: 'other' };
}

// 職人の言葉で、押すところだけ。
export function homeScreenSteps(state) {
  if (state.kind === 'ios') {
    if (state.inLine) return { lead: 'LINE の中では置けません。先に Safari で開きます。', steps: ['右下の「…」か 共有 を押して、「Safari で開く」', 'Safari で開くと、この案内がもう一度出ます'], safari: true };
    if (state.otherBrowser) return { lead: '', steps: ['共有(□↑)を押す', '「ホーム画面に追加」を押す', '「追加」を押す'] };
    if (state.compact) return { lead: '', steps: ['下の「…」を押す(共有 □↑ が見えていれば、それでも)', '「共有」を押す', '「ホーム画面に追加」を押す', '右上の「追加」を押す'] };
    return { lead: '', steps: ['下の 共有(□↑)を押す', '「ホーム画面に追加」を押す', '右上の「追加」を押す'] };
  }
  if (state.kind === 'android') {
    if (state.prompt) return { lead: '', steps: [], button: 'ホーム画面に置く' };
    return { lead: '', steps: ['右上の「⋮」を押す', '「ホーム画面に追加」か「アプリをインストール」を押す', '「追加」を押す'] };
  }
  return null;
}

export function readLater() {
  try { return localStorage.getItem(LATER_KEY) === '1'; } catch { return false; }
}
export function writeLater() {
  try { localStorage.setItem(LATER_KEY, '1'); } catch { /* 覚えられなくても、この画面の間は出ない */ }
}

// LINE から Safari へ。LINE の決まり(openExternalBrowser=1)。LINE の中のブラウザから効くかは実機で確かめる
export function safariLink(loc = location) {
  return `${loc.origin}${loc.pathname}?openExternalBrowser=1`;
}

const $ = (tag, text = '', attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });

/**
 * 案内の一枚。閉じ方は「あとで」(もう出さない)か、置き終えて開き直すか。
 * @param {object} state  homeScreenState() の答え
 * @param {object} o
 * @param {object} [o.installPrompt]  Android の beforeinstallprompt
 * @param {boolean} [o.hasRecords]  この置き場所(Safari)に、もう記録があるか
 */
export function openHomeScreenGuide(state, { installPrompt = null, hasRecords = false, onLater = () => {} } = {}) {
  const text = homeScreenSteps(state);
  if (!text) return null;
  document.getElementById('homescreen-guide')?.remove();
  const dialog = $('dialog', '', { className: 'local-dialog homescreen-guide', id: 'homescreen-guide' });
  dialog.setAttribute('aria-label', 'ホーム画面に置く');
  const head = $('header');
  const close = $('button', 'あとで', { className: 'local-close', type: 'button', id: 'homescreen-later' });
  head.append($('h2', 'ホーム画面に置く'), close);
  dialog.append(head);
  dialog.append($('p', '置いておくと、記録が消えません。開くのも一回で済みます。'));
  if (text.lead) dialog.append($('p', text.lead));
  if (text.steps.length) {
    const ol = $('ol', '', { className: 'homescreen-steps' });
    for (const s of text.steps) ol.append($('li', s));
    dialog.append(ol);
  }
  if (text.safari) {
    const a = $('a', 'Safari で開く', { href: safariLink(), className: 'local-action', id: 'homescreen-safari' });
    dialog.append(a);
  }
  if (text.button) {
    const b = $('button', text.button, { type: 'button', className: 'local-action', id: 'homescreen-install' });
    b.onclick = async () => {
      if (!installPrompt) return;
      try { await installPrompt.prompt(); } catch { /* 置けなかったら、そのまま */ }
    };
    dialog.append(b);
  }
  if (!text.safari) dialog.append($('p', '置いたら、次からはホーム画面の Senlings から開いてください。', { className: 'later-note' }));
  if (hasRecords && !text.safari) dialog.append($('p', 'ここ(ブラウザ)で入れた記録は、ホーム画面の Senlings には移りません。持っていくなら、▲ホームの「JSON」で持ち出してから。', { className: 'later-note' }));
  close.onclick = () => { writeLater(); dialog.close(); dialog.remove(); onLater(); };
  dialog.addEventListener('cancel', e => { e.preventDefault(); close.onclick(); });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
