// envelope.js — 封筒(配線の約束の一種類だけの形)を、LINE などの文に乗せる。画面にも保存にもネットにも依らない。
//
// 2026-10-25 船長:「応援とおなじく、元請けが依頼するのも同じながれ」。
// - 職人が応援を頼むのも、元請けが現場を依頼するのも、封筒一通。違うのは差出人と種類だけ。
// - 中身は人が読む文そのもの。Senlings は文の決まった行(■ 現場名、時間:、住所: …)から読む。
// - いちばん下の短い一行(〔Senlings〕…)には、どの現場の何版かと、文が欠けていないかの印だけ。日本語は入れない。
// - 道の上(サーバー)には何も置かない。送るのは人(LINE・SMS・メール)。受けるかは受けた人が決める。
// - 封筒に入れないもの:既読、返事の催促、位置、評価、点数、自分のメモ・写真・勤怠・請求。

export const ENVELOPE_FORMAT = 'senlings.envelope';
export const KINDS = Object.freeze({ genba: '現場案内', ouen: '応援のお願い' });
const HEAD = Object.freeze({ genba: '現場のご案内', ouen: '応援のお願い' });
// 現場の項目(物件の手渡しと同じ名前)。文では一行ずつ(改行は「 / 」にする)
export const SITE_FIELDS = Object.freeze([
  ['address', '住所'], ['entrance', '入口'], ['morning_assembly', '朝礼'], ['parking', '駐車'],
  ['delivery', '搬入'], ['equipment', '装備・入場条件'], ['toilet', 'トイレ'], ['contact', '担当'], ['contact_phone', '電話'],
]);
export const TOKEN_MARK = '〔Senlings〕';
const TOKEN_RE = /〔Senlings〕([A-Za-z0-9_-]{8,})/;
const FOOT = 'Senlings を使っている人は、この文をまるごとコピーして、Senlings の「受け取る」へ。';
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TOKEN = 600;

const str = (v, max) => typeof v === 'string' && v.length <= max;
const oneLine = (v, max) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').split('\n').map(s => s.trim()).filter(Boolean).join(' / ').slice(0, max) : '');
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function shortId() {
  const r = globalThis.crypto?.getRandomValues?.(new Uint8Array(8)) ?? Uint8Array.from({ length: 8 }, () => Math.floor(Math.random() * 256));
  return [...r].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 12);
}
// FNV-1a 32bit(依存ゼロ)。照合用IDの短縮と、文が欠けていないかの印に使う
export function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// 署名(会社・名前・電話):文の下に添える。四行まで。空の行と「■ 」で始まる行は詰める
function signLines(sign) {
  return (sign ?? '').toString().replace(/\r\n?/g, '\n').split('\n').map(l => l.trim().replace(/^■\s+/, '■')).filter(Boolean).slice(0, 4).join('\n').slice(0, 300);
}
// 一言は何行でもいい。ただ、空の行と「■ 」で始まる行は、文の区切りと紛れるので詰める
function noteLines(note) {
  return (note ?? '').toString().replace(/\r\n?/g, '\n').split('\n').map(l => l.trim().replace(/^■\s+/, '■')).filter(Boolean).join('\n').slice(0, 2000);
}

/** 封筒を作る。空の項目は入れない。形が合わなければ止める。 */
export function makeEnvelope({ kind, from, to = '', date, work_date = '', note = '', sign = '', site = {}, id = shortId() } = {}) {
  const name = oneLine(site.name, 200);
  const s = {
    source_id: oneLine(site.source_id, 200) || `n${fnv(name)}`,
    revision: Number.isSafeInteger(site.revision) && site.revision > 0 ? site.revision : 1,
    name,
  };
  if (site.start || site.end) { s.start = oneLine(site.start, 5); s.end = oneLine(site.end, 5); }
  for (const [key] of SITE_FIELDS) { const v = oneLine(site[key], 2000); if (v) s[key] = v; }
  const env = { format: ENVELOPE_FORMAT, v: 1, id: oneLine(id, 100), kind, from: oneLine(from, 100), to: oneLine(to, 100),
    date: oneLine(date, 10), work_date: oneLine(work_date, 10), note: noteLines(note), sign: signLines(sign), site: s };
  for (const k of ['to', 'work_date', 'note', 'sign']) if (!env[k]) delete env[k];
  return checkEnvelope(env);
}

/** 封筒の形を確かめる。直さずに止める(保存の作法と同じ)。 */
export function checkEnvelope(env) {
  const ok = record(env) && env.format === ENVELOPE_FORMAT && env.v === 1 && str(env.id, 100) && env.id && /^[A-Za-z0-9_-]+$/.test(env.id)
    && Object.hasOwn(KINDS, env.kind) && str(env.from, 100) && !/[\n]/.test(env.from) && !env.from.includes('】') && (env.to == null || str(env.to, 100))
    && str(env.date, 10) && DATE.test(env.date) && (env.work_date == null || (str(env.work_date, 10) && DATE.test(env.work_date)))
    && (env.note == null || (str(env.note, 2000) && !env.note.split('\n').some(l => l.trim() === '' || l.startsWith('■ ')))) && record(env.site)
    && (env.sign == null || (str(env.sign, 300) && env.sign.split('\n').length <= 4 && !env.sign.split('\n').some(l => l.trim() === '' || l.startsWith('■ '))))
    && str(env.site.source_id, 200) && /^[A-Za-z0-9_.:-]+$/.test(env.site.source_id) && Number.isSafeInteger(env.site.revision) && env.site.revision > 0
    && str(env.site.name, 200) && env.site.name.trim() && !/\n/.test(env.site.name)
    && ((env.site.start == null && env.site.end == null) || (HM.test(env.site.start ?? '') && HM.test(env.site.end ?? '') && env.site.start < env.site.end))
    && Object.keys(env).every(k => ['format', 'v', 'id', 'kind', 'from', 'to', 'date', 'work_date', 'note', 'sign', 'site'].includes(k))
    && Object.keys(env.site).every(k => ['source_id', 'revision', 'name', 'start', 'end', ...SITE_FIELDS.map(([f]) => f)].includes(k))
    && SITE_FIELDS.every(([f]) => env.site[f] == null || (str(env.site[f], 2000) && !/\n/.test(env.site[f])));
  if (!ok) {
    if (record(env) && record(env.site) && !(typeof env.site.name === 'string' && env.site.name.trim())) throw new Error('現場名を入れてください。');
    if (record(env) && record(env.site) && (env.site.start || env.site.end) && !(HM.test(env.site.start ?? '') && HM.test(env.site.end ?? '') && env.site.start < env.site.end)) throw new Error('時間(始業と終業)を確かめてください。');
    throw new Error('依頼の形を読み取れません。');
  }
  return env;
}

// ── 文にする ────────────────────────────────────────────

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  return `${m}/${d}(${WD[new Date(y, m - 1, d).getDay()]})`;
}
const hm = t => t.replace(/^0/, '');
const pad = t => (t.length === 4 ? `0${t}` : t);

/** 人が読む本文(Senlings 用の一行とリンクの前まで)。受け取る側もこれと突き合わせる */
export function bodyText(env) {
  const s = env.site;
  const who = env.from ? `${env.from}より` : '';
  const when = env.work_date ? `${dayLabel(env.work_date)}、` : '';
  const lines = [`【${HEAD[env.kind]}】${who}`];
  lines.push(env.kind === 'ouen' ? `${when}${s.name} に来てもらえませんか。` : `${when}${s.name} をお願いします。`);
  if (env.note) lines.push(...env.note.split('\n'));
  lines.push('', `■ ${s.name}`);
  if (env.work_date) lines.push(`日にち:${dayLabel(env.work_date)}`);
  if (s.start && s.end) lines.push(`時間:${hm(s.start)}〜${hm(s.end)}`);
  for (const [key, label] of SITE_FIELDS) if (s[key]) lines.push(`${label}:${s[key]}`);
  if (env.sign) lines.push('', ...env.sign.split('\n')); // 署名は、空の一行をはさんで下に
  return lines.join('\n');
}

// 一行に乗せるのは、日本語の入らない短いものだけ
function b64url(text) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(token) {
  return atob(token.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((token.length + 3) % 4));
}

export function encodeToken(env) {
  checkEnvelope(env);
  const t = { v: 1, i: env.id, k: env.kind === 'ouen' ? 'o' : 'g', s: env.site.source_id, r: env.site.revision, d: env.date, h: fnv(bodyText(env)) };
  if (env.work_date) t.w = env.work_date;
  return b64url(JSON.stringify(t));
}

/** 人が読む文。いちばん下の短い一行だけが Senlings 用。 */
export function envelopeText(env, { link = '' } = {}) {
  const lines = [bodyText(env), '', FOOT];
  if (link) lines.push(`Senlings で開く → ${link}`);
  lines.push(`${TOKEN_MARK}${encodeToken(env)}`);
  return lines.join('\n');
}

// ── リンクで開く(10-25 夜 船長「開いて何もないのは避ける」) ──
// 封筒そのものをリンクの # の後ろに入れる。# の後ろはサーバーへ送られない(Vercel にも残らない)。
// 縮められるときは縮める(z)。縮められないブラウザは、そのまま(j)。
const LINK_KEY = 'r';
export const MAX_LINK_CODE = 6000;
function bytesB64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return b64url(s);
}
function b64Bytes(code) { const s = unb64url(code); return Uint8Array.from(s, c => c.charCodeAt(0)); }
async function through(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export async function linkCode(env) {
  checkEnvelope(env);
  const bytes = new TextEncoder().encode(JSON.stringify(env));
  if (typeof CompressionStream === 'function') {
    try { return `z${bytesB64(await through(bytes, new CompressionStream('deflate-raw')))}`; } catch { /* そのまま */ }
  }
  return `j${bytesB64(bytes)}`;
}
export async function fromLinkCode(code) {
  if (typeof code !== 'string' || code.length < 2 || code.length > MAX_LINK_CODE || !/^[zj][A-Za-z0-9_-]+$/.test(code)) throw new Error(CUT);
  let env;
  try {
    let bytes = b64Bytes(code.slice(1));
    if (code[0] === 'z') bytes = await through(bytes, new DecompressionStream('deflate-raw'));
    env = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new Error(CUT); }
  try { return checkEnvelope(env); } catch { throw new Error(CUT); }
}
/** 依頼の入ったリンク。長すぎるときは、ただの入口(文を貼ってもらう)。 */
export async function envelopeLink(env, base) {
  if (!base) return '';
  let code = '';
  try { code = await linkCode(env); } catch { return base; }
  return code.length <= MAX_LINK_CODE ? `${base}#${LINK_KEY}=${code}` : base;
}
/** # の後ろを読む。依頼なら { request: code }、施設の入口なら { shisetsu: 名前 }。 */
export function readArrival(hash) {
  const h = (hash ?? '').replace(/^#/, '');
  if (!h) return null;
  const out = {};
  // # の後ろは & で区切る:r=依頼 / shisetsu=施設の名前 / k=鍵(置くときに写す。ホーム画面の Senlings が同じ郵便受けを持つため)
  for (const part of h.split('&')) {
    if (part.startsWith(`${LINK_KEY}=`)) out.request = part.slice(LINK_KEY.length + 1);
    else if (part === 'shisetsu' || part.startsWith('shisetsu=')) {
      let name = '';
      try { name = decodeURIComponent(part.slice('shisetsu='.length)); } catch { name = ''; }
      out.shisetsu = oneLine(name, 100);
    } else if (part.startsWith('k=') && /^[A-Za-z0-9_-]{22}$/.test(part.slice(2))) out.key = part.slice(2);
  }
  return Object.keys(out).length ? out : null;
}
/** # の後ろに鍵を足す(無ければそのまま)。 */
export function withKey(hash, key) {
  const h = (hash ?? '').replace(/^#/, '');
  if (!key) return h ? `#${h}` : '';
  const parts = h ? h.split('&').filter(p => !p.startsWith('k=')) : [];
  parts.push(`k=${key}`);
  return `#${parts.join('&')}`;
}

const CUT = '依頼の文が途中で切れているか、変わっています。届いた文をまるごとコピーして、もう一度貼ってください。';

/** 貼られた文から封筒を読む。無ければ null。欠けていれば止める。 */
export function findEnvelope(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(TOKEN_RE);
  if (!m) return null;
  if (m[1].length > MAX_TOKEN) throw new Error(CUT);
  let t;
  try { t = JSON.parse(unb64url(m[1])); } catch { throw new Error(CUT); }
  if (!record(t) || t.v !== 1 || !['o', 'g'].includes(t.k) || typeof t.h !== 'string') throw new Error(CUT);
  const kind = t.k === 'o' ? 'ouen' : 'genba';
  // 本文:見出し【…】の行から、「Senlings を使っている人は」の手前まで
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex(l => l.trim() === `【${HEAD[kind]}】` || (l.trim().startsWith(`【${HEAD[kind]}】`) && l.trim().endsWith('より')));
  const end = lines.findIndex((l, i) => i > start && l.trim() === FOOT);
  if (start < 0 || end < 0) throw new Error(CUT);
  const body = lines.slice(start, end).map(l => l.trimEnd());
  while (body.length && body.at(-1) === '') body.pop();
  const head = body[0].trim().slice(HEAD[kind].length + 2);
  const from = head.endsWith('より') ? head.slice(0, -2) : head;
  const mark = body.findIndex(l => l.startsWith('■ '));
  if (mark < 2) throw new Error(CUT);
  const name = body[mark].slice(2);
  const note = body.slice(2, mark).join('\n').trim();
  const site = { source_id: t.s, revision: t.r, name };
  // 現場の項目は「■ 」の次から、空の行まで。空の行の下は署名
  const rest = body.slice(mark + 1);
  const blank = rest.findIndex(l => l.trim() === '');
  const fieldLines = blank < 0 ? rest : rest.slice(0, blank);
  const sign = blank < 0 ? '' : rest.slice(blank + 1).join('\n');
  for (const l of fieldLines) {
    const i = l.indexOf(':'); if (i < 0) continue;
    const label = l.slice(0, i), value = l.slice(i + 1);
    if (label === '時間') { const [a, b] = value.split('〜'); site.start = pad(a ?? ''); site.end = pad(b ?? ''); continue; }
    const f = SITE_FIELDS.find(([, lab]) => lab === label); if (f) site[f[0]] = value;
  }
  let env;
  try { env = makeEnvelope({ id: t.i, kind, from, date: t.d, work_date: t.w ?? '', note, sign, site }); } catch { throw new Error(CUT); }
  if (fnv(bodyText(env)) !== t.h) throw new Error(CUT);
  return env;
}

/** Senlings 用の一行とその案内を除いた本文。 */
export function bodyOf(text) {
  return text.split('\n').filter(l => !l.includes(TOKEN_MARK)).join('\n').trim();
}

/**
 * 封筒を、物件の手渡しの形(senlings.project-handoff)に直す。受け取り・版・表札の扱いは、手渡しの作法をそのまま使う。
 * 届いた連絡の原文には、人が読む本文を残す(封筒から作るので、貼り方に左右されない。同じ封筒なら何度貼っても同じ)。
 */
export function envelopeToTransfer(env) {
  checkEnvelope(env);
  const project = { name: env.site.name };
  for (const [key] of SITE_FIELDS) if (env.site[key]) project[key] = env.site[key];
  project.raw = bodyText(env).slice(0, 20000);
  return { format: 'senlings.project-handoff', schema_version: 1, source_project_id: env.site.source_id, revision: env.site.revision, project };
}
