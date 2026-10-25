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
