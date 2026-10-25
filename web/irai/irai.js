// 元請けの「現場の依頼」。職人の「応援を呼ぶ」と同じ部品・同じ封筒(種類だけが違う)。
// 何も保存しない。呼び名だけ、この端末に覚える(localStorage)。
import { renderComposer } from '../src/pwa/requestUI.js';

const FROM_KEY = 'senlings_irai_from';
let from = '';
try { from = localStorage.getItem(FROM_KEY) ?? ''; } catch { /* 覚えられなくても使える */ }
renderComposer(document.getElementById('composer'), {
  kind: 'genba',
  from,
  onFrom: v => { try { if (v) localStorage.setItem(FROM_KEY, v); } catch { /* そのまま */ } },
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
