// yubin.js — 郵便受け(配線の約束:郵便受けは Senlings 側、鍵は職人、届いたら道から消える)。
//
// なぜ要るか(10-26):iPhone は、LINE のリンクをホーム画面の Senlings に渡さない。リンクはブラウザで開く。
// ブラウザとホーム画面の Senlings は、同じスマホの中でも記録を共有しない。コピー貼り付けは無し(船長)。
// だから、同じスマホの中で部屋をまたぐ道が要る。それがこの郵便受け。
//
// 船長の決め(10-26):「あずかりしらぬとこで。お互いのスマホに残っていればいい」
// - 封をして出す。鍵(16バイトの乱数)はそのスマホの中にだけ(ブラウザとホーム画面の両方。置くときに一度だけ写す)。
//   郵便受けの番号は鍵のハッシュ。郵便受け(Firestore)には封をした中身だけが置かれ、Senlings にも誰にも読めない。
// - 受け取ったら消す。受け取られなかったものも、日限(x)で消える。残るのは、お互いのスマホの中だけ。
// - 郵便受けに「家がある」の印(home)だけ置く。中身は無い。ブラウザは、これで「もうホーム画面に置いてある」と分かる。
//
// 道具:WebCrypto(AES-GCM)と fetch だけ。SDK は使わない。

const PROJECT = 'senlings-7e838';
const API_KEY = 'AIzaSyBNaj9bllnBSjlnL63smknkSK7T8SNnWZo'; // 公開の鍵(Firebase の web 用)。守りはルール側
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
export const ITEM_DAYS = 14;   // 受け取られなかった封筒が消えるまで
export const HOME_DAYS = 400;  // 「家がある」の印が消えるまで(開くたびに延びる)
const MAX_SEAL = 8000;

const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const subtle = () => globalThis.crypto?.subtle;

/** 鍵を作る(16バイトの乱数、文字で22字)。このスマホの中にだけ置く。 */
export function makeKey() {
  const b = new Uint8Array(16); globalThis.crypto.getRandomValues(b);
  return b64(b);
}
export function isKey(k) { return typeof k === 'string' && /^[A-Za-z0-9_-]{22}$/.test(k); }

/** 郵便受けの番号。鍵のハッシュ(鍵そのものは出さない)。 */
export async function boxIdOf(key) {
  if (!isKey(key)) throw new Error('鍵の形が違います。');
  const h = new Uint8Array(await subtle().digest('SHA-256', enc.encode(`senlings-yubin:${key}`)));
  return b64(h.subarray(0, 18));
}

async function aesKey(key) {
  return subtle().importKey('raw', unb64(key), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** 封をする。中身は文(封筒のリンクの中身など)。 */
export async function seal(key, text) {
  const iv = new Uint8Array(12); globalThis.crypto.getRandomValues(iv);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await aesKey(key), enc.encode(text)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  const s = b64(out);
  if (s.length > MAX_SEAL) throw new Error('封筒が大きすぎます。');
  return s;
}

/** 封を開ける。鍵が違えば開かない(投げる)。 */
export async function openSeal(key, sealed) {
  if (typeof sealed !== 'string' || sealed.length > MAX_SEAL) throw new Error('封が壊れています。');
  const bytes = unb64(sealed);
  if (bytes.length < 13) throw new Error('封が壊れています。');
  try {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, await aesKey(key), bytes.subarray(12));
    return dec.decode(pt);
  } catch { throw new Error('封が開きません(鍵が違います)。'); }
}

// ── 郵便受け(Firestore REST) ──────────────────────────────
async function call(method, path, body, fetchFn) {
  const res = await fetchFn(`${BASE}/${path}${path.includes('?') ? '&' : '?'}key=${API_KEY}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`郵便受けに届きません(${res.status})。`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}
const field = (v) => typeof v === 'string' ? { stringValue: v } : typeof v === 'boolean' ? { booleanValue: v } : v instanceof Date ? { timestampValue: v.toISOString() } : { integerValue: String(v) };
const fields = o => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, field(v)])) });
const unfield = f => f?.stringValue ?? (f?.booleanValue ?? (f?.integerValue != null ? Number(f.integerValue) : (f?.timestampValue ?? null)));

/**
 * 封をして郵便受けへ。
 * @returns {Promise<string>} 郵便受けの中の札(消すときに使う)
 */
export async function put(key, text, { fetch: fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  const box = await boxIdOf(key);
  const c = await seal(key, text);
  const doc = await call('POST', `boxes/${box}/items`, fields({ c, t: Date.now(), x: new Date(Date.now() + ITEM_DAYS * 86400000) }), fetchFn);
  return doc?.name?.split('/').pop() ?? '';
}

/**
 * 郵便受けを見る。開けられたものだけ返す(古い順)。消すのは、受け取った側が済んでから(remove)。
 * @returns {Promise<Array<{id:string, text:string, t:number}>>}
 */
export async function peek(key, { fetch: fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  const box = await boxIdOf(key);
  const res = await call('GET', `boxes/${box}/items?pageSize=50`, null, fetchFn);
  const docs = res?.documents ?? [];
  const out = [];
  for (const d of docs) {
    const id = d.name.split('/').pop();
    try { out.push({ id, text: await openSeal(key, unfield(d.fields?.c)), t: Number(unfield(d.fields?.t) ?? 0) }); }
    catch { /* 開かない封筒は、そのまま日限で消える */ }
  }
  return out.sort((a, b) => a.t - b.t);
}

/** 受け取り済み。郵便受けから消す(道の上に留め置かない)。 */
export async function remove(key, id, { fetch: fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;
  const box = await boxIdOf(key);
  await call('DELETE', `boxes/${box}/items/${id}`, null, fetchFn);
}

/** 「家がある」の印を置く(ホーム画面の Senlings が、この鍵を持った)。中身は無い。 */
export async function markHome(key, { fetch: fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  const box = await boxIdOf(key);
  await call('PATCH', `boxes/${box}?updateMask.fieldPaths=home&updateMask.fieldPaths=x`, fields({ home: true, x: new Date(Date.now() + HOME_DAYS * 86400000) }), fetchFn);
}

/** 家はあるか(ブラウザ側が、置く案内を出すか「届けました」にするかを決める)。 */
export async function hasHome(key, { fetch: fetchFn = globalThis.fetch.bind(globalThis) } = {}) {
  const box = await boxIdOf(key);
  const doc = await call('GET', `boxes/${box}`, null, fetchFn);
  return unfield(doc?.fields?.home) === true;
}
