// ukeguchi.js — 受け口(10-26 船長「元請けとのつながりかた」「つながった元請けは PC からも現場を登録したい」)。
//
// つながるとは:職人が、元請けに「受け口」を渡すこと。受け口 = 郵便受けの番号(自分の鍵のハッシュ)と、その元請けだけの封の鍵。
// 受け口を持った元請けは、現場の依頼を封をして職人の郵便受けへ直接届けられる(PC からでも。LINE を通らない)。
// - 渡すかどうかは職人が決める(配線の約束)。越えない:受け口は、自分に頼む相手にだけ渡す
// - いつでも外せる。外したら、その鍵で封をされたものは開かず、消える
// - 受け口を何人に渡したかは、数えない。帳面(この端末)に、相手の名前と鍵があるだけ
// - 元請けは、職人の記録を見られない。届けられるだけ(Push)。箱の番号から鍵は分からない
import { load, update } from './storage.js';
import { makeKey, isKey } from './yubin.js';

const ID = /^uk[0-9a-f]{12}$/;
const BOX = /^[A-Za-z0-9_-]{24}$/;
const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 100) : '');

export function listUkeguchi() { return (load().ukeguchi ?? []).slice(); }

/** 受け口を作る(相手の名前を添えて)。鍵は相手ごと。 */
export function addUkeguchi({ label }) {
  const name = clean(label);
  if (!name) throw new Error('相手の名前(会社)を入れてください。');
  const b = new Uint8Array(6); globalThis.crypto.getRandomValues(b);
  const rec = { id: `uk${[...b].map(x => x.toString(16).padStart(2, '0')).join('')}`, label: name, key: makeKey(), created_at: Date.now() };
  update(data => { data.ukeguchi ??= []; data.ukeguchi.push(rec); return data; });
  return rec;
}

/** 受け口を外す。以後、その鍵のものは開かない。 */
export function removeUkeguchi(id) {
  update(data => { data.ukeguchi = (data.ukeguchi ?? []).filter(u => u.id !== id); return data; });
}

/** 元請けに渡すリンク。/irai/ が開いて、つながる。 */
export function ukeguchiLink(origin, box, key, name) {
  if (!BOX.test(box) || !isKey(key)) throw new Error('受け口の形が違います。');
  return `${origin}/irai/?openExternalBrowser=1#u=${box}.${key}${name ? `&n=${encodeURIComponent(clean(name))}` : ''}`;
}

/** /irai/ で、# の後ろから受け口を読む。 */
export function parseUkeguchi(hash) {
  const h = (hash ?? '').replace(/^#/, '');
  if (!h.startsWith('u=')) return null;
  let box = '', key = '', name = '';
  for (const part of h.split('&')) {
    if (part.startsWith('u=')) { const [b, k] = part.slice(2).split('.'); box = b ?? ''; key = k ?? ''; }
    else if (part.startsWith('n=')) { try { name = clean(decodeURIComponent(part.slice(2))); } catch { name = ''; } }
  }
  if (!BOX.test(box) || !isKey(key)) return null;
  return { box, key, name };
}

/** 渡す文(LINE など)。受け口のリンクと、ひとこと。 */
export function ukeguchiText({ name, label, link }) {
  return [`${label ? `${label} ` : ''}ご担当の方`,
    `${name ? `${name}です。` : ''}現場の依頼を、私の Senlings に直接届けられる受け口です。`,
    'このリンクをパソコンかスマホで開くと、つながります(LINE を通らずに届きます)。',
    link].join('\n');
}
