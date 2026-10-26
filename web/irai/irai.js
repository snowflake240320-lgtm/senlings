// 元請けの「現場の依頼」。職人の「応援を呼ぶ」と同じ部品・同じ封筒(種類だけが違う)。
// 何も保存しない。呼び名だけ、この端末に覚える(localStorage)。
import { renderComposer } from '../src/pwa/requestUI.js';
import { linkCode } from '../src/pwa/envelope.js';
import { putSealed } from '../src/pwa/yubin.js';
import { parseUkeguchi } from '../src/pwa/ukeguchi.js';

const FROM_KEY = 'senlings_irai_from';
let from = '';
try { from = localStorage.getItem(FROM_KEY) ?? ''; } catch { /* 覚えられなくても使える */ }

// ── つながっている職人(受け口。10-26)。この端末の中だけ ──
const TSUNAGARI_KEY = 'senlings_irai_tsunagari';
function readTsunagari() { try { const v = JSON.parse(localStorage.getItem(TSUNAGARI_KEY) ?? '[]'); return Array.isArray(v) ? v.filter(u => u && typeof u.box === 'string' && typeof u.key === 'string') : []; } catch { return []; } }
function writeTsunagari(list) { try { localStorage.setItem(TSUNAGARI_KEY, JSON.stringify(list)); } catch { /* 覚えられないときは、この画面の間だけ */ } }
let tsunagari = readTsunagari();
const tmsg = document.getElementById('tsunagari-msg');
function renderTsunagari() {
  const list = document.getElementById('tsunagari-list'); list.replaceChildren();
  if (!tsunagari.length) { const p = document.createElement('p'); p.className = 'request-msg'; p.textContent = 'まだありません。'; list.append(p); }
  for (const u of tsunagari) {
    const row = document.createElement('div'); row.className = 'local-choice';
    const s = document.createElement('span'); s.textContent = `${u.name || '(名前なし)'}(${new Date(u.added_at).toLocaleDateString('ja-JP')} から)`;
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'local-remove'; rm.textContent = '外す'; rm.id = `tsunagari-rm-${u.box.slice(0, 6)}`;
    rm.onclick = () => { tsunagari = tsunagari.filter(x => x !== u); writeTsunagari(tsunagari); renderTsunagari(); renderTodoke(); tmsg.textContent = `${u.name || '受け口'} を外しました。`; };
    row.append(s, rm); list.append(row);
  }
}
// 受け口のリンクで開いたとき:つながる。同じ職人(同じ箱)は、新しい鍵に差し替え
(function arrive() {
  const u = parseUkeguchi(location.hash);
  if (!u) return;
  try { history.replaceState(null, '', `${location.pathname}${location.search}`); } catch { /* そのまま */ }
  tsunagari = tsunagari.filter(x => x.box !== u.box);
  tsunagari.push({ box: u.box, key: u.key, name: u.name, added_at: Date.now() });
  writeTsunagari(tsunagari);
  tmsg.textContent = `${u.name || '職人'} とつながりました。現場の依頼を、そのまま届けられます。`;
})();
renderTsunagari();

// ── 届ける(文を見たあと、つながっている職人を選んで) ──
let made = null; // { env, text }
const todoke = document.getElementById('todoke'), todokeList = document.getElementById('todoke-list'), todokeSend = document.getElementById('todoke-send'), todokeMsg = document.getElementById('todoke-msg');
function renderTodoke() {
  todoke.hidden = !(made && tsunagari.length);
  todokeList.replaceChildren();
  for (const u of tsunagari) {
    const l = document.createElement('label'); l.className = 'local-choice';
    const c = document.createElement('input'); c.type = 'checkbox'; c.value = u.box; c.className = 'todoke-pick';
    l.append(c, document.createTextNode(u.name || '(名前なし)')); todokeList.append(l);
  }
  todokeSend.disabled = !tsunagari.length; todokeMsg.textContent = '';
}
todokeSend.onclick = async () => {
  if (!made) return;
  const picked = [...todokeList.querySelectorAll('.todoke-pick:checked')].map(c => tsunagari.find(u => u.box === c.value)).filter(Boolean);
  if (!picked.length) { todokeMsg.textContent = '届ける人を選んでください。'; return; }
  todokeSend.disabled = true;
  const done = [], failed = [];
  try {
    const code = await linkCode(made.env);
    for (const u of picked) {
      try { await putSealed(u.box, u.key, `r=${code}`); done.push(u.name || '(名前なし)'); }
      catch (e) { failed.push(`${u.name || '(名前なし)'}(${e.message})`); }
    }
  } catch (e) { failed.push(e.message); }
  todokeMsg.textContent = `${done.length ? `届けました:${done.join('、')}。相手が Senlings を開いたときに出ます。` : ''}${failed.length ? ` 届きませんでした:${failed.join('、')}` : ''}`.trim();
  todokeSend.disabled = false;
};

renderComposer(document.getElementById('composer'), {
  kind: 'genba',
  from,
  onFrom: v => { try { if (v) localStorage.setItem(FROM_KEY, v); } catch { /* そのまま */ } },
  onMade: (env, text) => { made = env ? { env, text } : null; renderTodoke(); },
});

// 施設の入口(10-25 夜 船長「施設紹介なら施設」)。名前だけが入ったリンク。何も保存しない
const nameIn = document.getElementById('shisetsu-name-in');
const out = document.getElementById('shisetsu-out');
const share = document.getElementById('shisetsu-share');
const msg = document.getElementById('shisetsu-msg');
let text = '';
nameIn.oninput = () => { text = ''; out.hidden = true; share.hidden = true; msg.textContent = ''; };
document.getElementById('shisetsu-make').onclick = () => {
  const name = nameIn.value.replace(/\s+/g, ' ').trim().slice(0, 100);
  const link = `${location.origin}/?openExternalBrowser=1#shisetsu${name ? `=${encodeURIComponent(name)}` : ''}`;
  text = `${name ? `【${name}】` : ''}Senlings の施設の入口です。施設の決まりと、仲間の四人が見られます。\n${link}`;
  out.textContent = text; out.hidden = false; share.hidden = false; msg.textContent = '';
};
share.onclick = async () => {
  if (!text) return;
  if (navigator.share) {
    try { await navigator.share({ text }); msg.textContent = '共有の画面に渡しました。'; return; }
    catch (e) { if (e?.name === 'AbortError') { msg.textContent = 'まだ送っていません。'; return; } }
  }
  try { await navigator.clipboard.writeText(text); msg.textContent = 'コピーしました。LINE などに貼って送ってください。'; }
  catch { msg.textContent = '上の文を長押しして選んでください。'; }
};
