// homeScreen.js — ホーム画面に置く(2026-10-25 船長の決め:入口は LINE、家はホーム画面)
//
// iPhone は、サイトが自分でホーム画面に置くことを許していない。だから職人の指は Safari で 3〜4 回。
// 減らせないので、迷わない一枚にする。絵で見せる(文字だけだと脱落する。10-25 船長)。
// 初日に船長が横で見る手順書でもある(手渡し。職人の指は 0 回)。
// - ホーム画面から開いているときは、何も出さない
// - 「いまは置かずに使う」は小さく下に。押したら、もう出さない(▲ホームの設定から開ける)。催促しない
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
    const chrome = /CriOS/.test(ua);
    return { kind: 'ios', major, inLine, chrome, otherBrowser: chrome || /FxiOS|EdgiOS|OPT\//.test(ua), compact: major >= 26 };
  }
  if (/Android/.test(ua)) return { kind: 'android', inLine, prompt: !!installPrompt };
  return { kind: 'other' };
}

// 職人の言葉で、押すところだけ。pic は下の絵の名前。
export function homeScreenSteps(state) {
  // 共有の一覧は長い。丸い印の右端「表示を増やす」を押さないと、「ホーム画面に追加」が出てこない(10-25 船長の iPhone で)
  const more = { text: '丸い印の右端「表示を増やす」を押す', pic: 'more' };
  const sheet = { text: '下の「ホーム画面に追加」を押す', pic: 'sheet' };
  const add = { text: '右上の「追加」を押す', pic: 'add' };
  if (state.kind === 'ios') {
    if (state.inLine) return { lead: '', steps: [{ text: '右下の「…」(無ければ □↑)→「Safari で開く」', pic: 'line' }], safari: true };
    if (state.chrome) return { lead: '', steps: [{ text: '右上の 共有(□↑)を押す', pic: 'chrome' }, more, sheet, add] };
    if (state.otherBrowser) return { lead: '', steps: [{ text: '共有(□↑)を押す(上の段か、下の段にあります)', pic: 'share' }, more, sheet, add] };
    if (state.compact) return { lead: '', steps: [{ text: '下の「…」を押す(共有 □↑ が見えていれば、それでも)', pic: 'safari26' }, { text: '「共有」を押す', pic: 'menu' }, more, sheet, add] };
    return { lead: '', steps: [{ text: 'いちばん下の 共有(□↑)を押す', pic: 'safari18' }, more, sheet, add] };
  }
  if (state.kind === 'android') {
    if (state.prompt) return { lead: '', steps: [], button: 'ホーム画面に置く' };
    return { lead: '', steps: [{ text: '右上の「⋮」を押す', pic: 'android' }, { text: '「ホーム画面に追加」か「アプリをインストール」を押す', pic: null }, { text: '「追加」を押す', pic: null }] };
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
export function safariLink(loc = location, hash = '') {
  return `${loc.origin}${loc.pathname}?openExternalBrowser=1${hash ? `#${hash.replace(/^#/, '')}` : ''}`;
}

// ── 絵 ──────────────────────────────────────────────────
// iPhone の画面の形を、押すところだけ金で囲んで描く。写真(sheet)は船長の iPhone の実物から。
const BLUE = '#0a84ff', GOLD = '#c5a059', PANEL = '#1c1c1e', PILL = '#2c2c2e', TXT = '#f2f2f7', MUTE = '#8e8e93';
const shareGlyph = (x, y, s = 1, c = BLUE) => `<g transform="translate(${x} ${y}) scale(${s})" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M-7 -2 h-3 v16 h20 v-16 h-3"/><path d="M0 -12 v16"/><path d="M-5 -7 l5 -5 l5 5"/></g>`;
const ring = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(w, h) / 2}" fill="none" stroke="${GOLD}" stroke-width="3"/>`;
const sIcon = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s / 24})"><rect width="24" height="24" rx="5.5" fill="#1a1a1a"/><g fill="#fff"><rect x="4" y="4" width="16" height="3"/><rect x="4" y="4" width="3" height="9.5"/><rect x="4" y="10.5" width="16" height="3"/><rect x="17" y="10.5" width="3" height="9.5"/><rect x="4" y="17" width="16" height="3"/></g></g>`;
const PICS = {
  // iOS 18 まで:下の段の真ん中が 共有
  safari18: `<svg viewBox="0 0 340 118" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="118" fill="${PANEL}"/><rect x="12" y="10" width="316" height="40" rx="12" fill="${PILL}"/><text x="30" y="35" font-size="13" fill="${TXT}">ぁあ</text><text x="170" y="35" font-size="13" fill="${TXT}" text-anchor="middle">senlings-git-… vercel.app</text><text x="306" y="36" font-size="16" fill="${TXT}">↻</text><g fill="none" stroke="${BLUE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M44 80 l-8 8 l8 8"/><path d="M98 80 l8 8 l-8 8"/><path d="M233 80 h14 v16 h-14 z M233 96 l7 -3 l7 3"/><rect x="291" y="80" width="14" height="14" rx="2"/><rect x="296" y="76" width="14" height="14" rx="2"/></g>${shareGlyph(170, 88)}${ring(146, 64, 48, 48)}</svg>`,
  // iOS 26:住所の右の「…」
  safari26: `<svg viewBox="0 0 340 118" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="118" fill="${PANEL}"/><path d="M30 46 l-8 10 l8 10" fill="none" stroke="${MUTE}" stroke-width="2.2" stroke-linecap="round"/><rect x="52" y="34" width="224" height="44" rx="22" fill="${PILL}"/><text x="164" y="61" font-size="13" fill="${TXT}" text-anchor="middle">senlings-git-… vercel.app</text><circle cx="308" cy="56" r="20" fill="${PILL}"/><text x="308" y="62" font-size="20" fill="${TXT}" text-anchor="middle" font-weight="700">…</text>${ring(282, 30, 52, 52)}</svg>`,
  // 「…」の中の 共有
  menu: `<svg viewBox="0 0 340 118" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="118" fill="${PANEL}"/><rect x="40" y="8" width="260" height="102" rx="14" fill="${PILL}"/><rect x="52" y="22" width="120" height="10" rx="5" fill="#48484a"/><rect x="52" y="78" width="150" height="10" rx="5" fill="#48484a"/><text x="60" y="58" font-size="16" fill="${TXT}">共有</text>${shareGlyph(270, 54, 0.9, TXT)}${ring(46, 38, 248, 32)}</svg>`,
  // 共有の一覧の、丸い印の列。右端の「表示を増やす」
  more: `<svg viewBox="0 0 340 118" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="118" fill="#2b2b2b"/><g fill="#4a4a4c"><circle cx="50" cy="40" r="28"/><circle cx="130" cy="40" r="28"/><circle cx="210" cy="40" r="28"/><circle cx="290" cy="40" r="28"/></g><g fill="none" stroke="${TXT}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="40" y="30" width="14" height="18" rx="2"/><path d="M46 30 v-4 h14 v18 h-4"/><rect x="117" y="33" width="20" height="13" rx="2"/><rect x="138" y="36" width="7" height="12" rx="1.5"/><circle cx="203" cy="42" r="6"/><circle cx="218" cy="42" r="6"/><path d="M209 42 h3"/><path d="M281 36 l9 9 l9 -9"/></g><g fill="${TXT}" font-size="11" text-anchor="middle"><text x="50" y="88">コピー</text><text x="130" y="88">デバイスに送信</text><text x="210" y="88">リーディング</text><text x="210" y="102">リストに追加</text><text x="290" y="88">表示を増やす</text></g>${ring(256, 6, 68, 68)}</svg>`,
  // 共有の一覧の中の「ホーム画面に追加」(写真)
  sheet: null,
  // 右上の「追加」
  add: `<svg viewBox="0 0 340 150" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="150" fill="${PANEL}"/><text x="16" y="34" font-size="15" fill="${BLUE}">キャンセル</text><text x="170" y="34" font-size="15" fill="${TXT}" text-anchor="middle" font-weight="700">ホーム画面に追加</text><text x="324" y="34" font-size="15" fill="${BLUE}" text-anchor="end" font-weight="700">追加</text>${ring(282, 14, 48, 30)}${sIcon(18, 72, 56)}<rect x="88" y="78" width="236" height="44" rx="10" fill="${PILL}"/><text x="102" y="106" font-size="16" fill="${TXT}">Senlings</text></svg>`,
  // Chrome(iPhone):右上の 共有
  chrome: `<svg viewBox="0 0 340 90" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="90" fill="#2b2b2b"/><rect x="12" y="22" width="316" height="46" rx="23" fill="#444"/><circle cx="38" cy="45" r="9" fill="none" stroke="${TXT}" stroke-width="2"/><circle cx="38" cy="45" r="3" fill="${TXT}"/><text x="170" y="50" font-size="14" fill="${TXT}" text-anchor="middle">…lgtms-projects.vercel.app</text>${shareGlyph(300, 45, 1, TXT)}${ring(276, 21, 48, 48)}</svg>`,
  // ほかのブラウザ:共有の印
  share: `<svg viewBox="0 0 340 90" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="90" fill="${PANEL}"/><text x="40" y="52" font-size="15" fill="${TXT}">この印を押す →</text>${shareGlyph(230, 45, 1.3)}${ring(200, 15, 60, 60)}</svg>`,
  // LINE の中:右下の「…」
  line: `<svg viewBox="0 0 340 118" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="118" fill="${PANEL}"/><rect x="0" y="70" width="340" height="48" fill="${PILL}"/><g fill="none" stroke="${MUTE}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M40 86 l-8 8 l8 8"/><path d="M90 86 l8 8 l-8 8"/></g>${shareGlyph(250, 94, 0.9, TXT)}<text x="306" y="100" font-size="22" fill="${TXT}" text-anchor="middle" font-weight="700">…</text><rect x="110" y="14" width="200" height="40" rx="10" fill="${PILL}"/><text x="130" y="40" font-size="15" fill="${TXT}">Safari で開く</text>${ring(284, 72, 44, 44)}</svg>`,
  // Android:右上の「⋮」
  android: `<svg viewBox="0 0 340 90" xmlns="http://www.w3.org/2000/svg"><rect width="340" height="90" fill="${PANEL}"/><rect x="14" y="22" width="276" height="44" rx="22" fill="${PILL}"/><text x="150" y="49" font-size="13" fill="${TXT}" text-anchor="middle">senlings-git-… vercel.app</text><text x="316" y="52" font-size="24" fill="${TXT}" text-anchor="middle" font-weight="700">⋮</text>${ring(296, 24, 40, 40)}</svg>`,
};
export const SHEET_IMG = 'icons/guide/sheet-add.jpg';

const $ = (tag, text = '', attrs = {}) => Object.assign(document.createElement(tag), { textContent: text, ...attrs });

function picture(name) {
  if (!name) return null;
  const fig = $('figure', '', { className: 'homescreen-pic' });
  if (name === 'sheet') {
    fig.append($('img', '', { src: SHEET_IMG, alt: '共有の一覧。「ホーム画面に追加」の行', loading: 'lazy' }));
  } else if (PICS[name]) {
    fig.innerHTML = PICS[name];
  } else return null;
  return fig;
}

/**
 * 案内の一枚。閉じ方は、置き終えてホーム画面から開き直すか、いちばん下の小さな「いまは置かずに使う」。
 * @param {object} state  homeScreenState() の答え
 * @param {object} o
 * @param {object} [o.installPrompt]  Android の beforeinstallprompt
 * @param {boolean} [o.hasRecords]  この置き場所(Safari)に、もう記録があるか
 */
/**
 * @param {object} [o.arrival]  リンクで届いたもの。{ label: 見出し, hash: Safari へ渡す # の後ろ, later: 置かずに使うときの言葉 }
 */
export function openHomeScreenGuide(state, { installPrompt = null, hasRecords = false, onLater = () => {}, arrival = null } = {}) {
  const text = homeScreenSteps(state);
  if (!text) return null;
  document.getElementById('homescreen-guide')?.remove();
  const dialog = $('dialog', '', { className: 'local-dialog homescreen-guide', id: 'homescreen-guide' });
  dialog.setAttribute('aria-label', 'ホーム画面に置く');
  const head = $('header', '', { className: 'homescreen-head' });
  const icon = $('span', '', { className: 'homescreen-icon' });
  icon.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${sIcon(0, 0, 24)}</svg>`;
  const h2 = $('h2', 'ホーム画面に置いてください'); h2.tabIndex = -1; h2.autofocus = true; // 開いたとき、小さな「いまは置かずに使う」に目印が付かないように
  head.append(icon, h2);
  dialog.append(head);
  // 届いたものは、何が・いつ・どこ、の二行だけ。押すものではないので、枠は付けない
  if (arrival?.label) {
    const card = $('div', '', { className: 'homescreen-arrival', id: 'homescreen-arrival' });
    card.append($('small', '届いています'), $('strong', arrival.label));
    dialog.append(card);
    // 置く理由は、この一言だけ(10-26 船長「わかりやすく」)
    dialog.append($('p', `置いて、ホーム画面から開くと、${arrival.kind === 'shisetsu' ? '施設' : 'この依頼'}が出ます。`, { className: 'homescreen-lead', id: 'homescreen-why' }));
  }
  if (text.lead) dialog.append($('p', text.lead, { className: 'homescreen-lead' }));
  if (text.steps.length) {
    dialog.append($('p', '手順', { className: 'homescreen-label' }));
    const ol = $('ol', '', { className: 'homescreen-steps' });
    for (const s of text.steps) {
      const li = $('li');
      li.append($('span', s.text, { className: 'homescreen-step-text' }));
      const fig = picture(s.pic);
      if (fig) li.append(fig);
      ol.append(li);
    }
    // 最後の一歩:置いた印を開く。届いたものがあれば、それが出る
    if (!text.safari) {
      const li = $('li', '', { id: 'homescreen-open-step' });
      const span = $('span', 'ホーム画面の ', { className: 'homescreen-step-text' });
      const ic = $('span', '', { className: 'homescreen-step-icon' });
      ic.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${sIcon(0, 0, 24)}</svg>`;
      span.append(ic, ' を開く');
      if (arrival?.label) span.append($('small', `→ ${arrival.kind === 'shisetsu' ? '施設' : 'この依頼'}が出ます`, { className: 'homescreen-step-note' }));
      li.append(span);
      ol.append(li);
    }
    dialog.append(ol);
  }
  if (text.safari) {
    dialog.append($('a', 'Safari で開く', { href: safariLink(location, arrival?.hash ?? ''), className: 'local-action', id: 'homescreen-safari' }));
  }
  if (text.button) {
    const b = $('button', text.button, { type: 'button', className: 'local-action', id: 'homescreen-install' });
    b.onclick = async () => {
      if (!installPrompt) return;
      try { await installPrompt.prompt(); } catch { /* 置けなかったら、そのまま */ }
    };
    dialog.append(b);
  }
  if (hasRecords && !text.safari) dialog.append($('p', 'ここ(ブラウザ)で入れた記録は、ホーム画面の Senlings には移りません。持っていくなら、▲ホームの「JSON」で持ち出してから。', { className: 'later-note' }));
  const later = $('button', arrival?.later ?? 'いまは置かずに使う', { className: 'homescreen-later', type: 'button', id: 'homescreen-later' });
  later.onclick = () => { writeLater(); dialog.close(); dialog.remove(); onLater(); };
  dialog.append(later);
  dialog.addEventListener('cancel', e => { e.preventDefault(); later.onclick(); });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

/**
 * ブラウザで開いたリンクを、ホーム画面の Senlings(家)へ届けたあとの一枚。
 * 届けたか/届かなかったか、だけ。開くのは家で。「ここで見る」は小さく下に。
 */
export function openDeliveredNote({ label = '', ok = true, error = '', onHere = () => {}, onGuide = null } = {}) {
  document.getElementById('homescreen-guide')?.remove();
  document.getElementById('delivered-note')?.remove();
  const dialog = $('dialog', '', { className: 'local-dialog homescreen-guide delivered-note', id: 'delivered-note' });
  dialog.setAttribute('aria-label', ok ? 'ホーム画面の Senlings に届けました' : '届けられませんでした');
  const head = $('header', '', { className: 'homescreen-head' });
  const icon = $('span', '', { className: 'homescreen-icon' });
  icon.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${sIcon(0, 0, 24)}</svg>`;
  const h2 = $('h2', ok ? 'ホーム画面の Senlings に届けました' : '届けられませんでした'); h2.tabIndex = -1; h2.autofocus = true;
  head.append(icon, h2);
  dialog.append(head);
  if (label) {
    const card = $('div', '', { className: 'homescreen-arrival', id: 'delivered-arrival' });
    card.append($('small', '届いています'), $('strong', label));
    dialog.append(card);
  }
  if (ok) {
    const p = $('p', 'ホーム画面の ', { className: 'homescreen-lead', id: 'delivered-why' });
    const ic = $('span', '', { className: 'homescreen-step-icon' });
    ic.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">${sIcon(0, 0, 24)}</svg>`;
    p.append(ic, ' を開くと、出ます。');
    dialog.append(p);
  } else {
    dialog.append($('p', `電波を確かめて、もう一度リンクを押してください。${error ? `(${error})` : ''}`, { className: 'homescreen-lead', id: 'delivered-why' }));
  }
  const here = $('button', 'ここで見る', { className: 'homescreen-later', type: 'button', id: 'delivered-here' });
  here.onclick = () => { dialog.close(); dialog.remove(); onHere(); };
  dialog.append(here);
  // 家が消えていたとき(印を消した・機種を変えた)の戻り道。置き直せば、郵便受けのものはそこへ届く
  if (onGuide) {
    const g = $('button', 'ホーム画面に Senlings が無いときは、置き方へ', { className: 'homescreen-later', type: 'button', id: 'delivered-guide' });
    g.onclick = () => { dialog.close(); dialog.remove(); onGuide(); };
    dialog.append(g);
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); dialog.close(); dialog.remove(); });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
