// seikyusaki.js — 請求先(10-26 船長「請求先の名刺をとって、請求書に反映したい」)。
// 請求先は、現場ごとに一つ選ぶ。同じ元請けは一度入れれば次の現場でも選べる(この端末の中の帳面)。
// 会社・住所(郵送)・担当者・電話・メール・LINE。請求書の宛先(〒・住所・会社名 御中)と担当者の列に載る。
// 名刺の写真からの読み取りは、まだ。まずは手で入れる。
import { load, update } from './storage.js';

export const SEIKYUSAKI_FIELDS = Object.freeze([
  ['company', '会社'], ['address', '住所(〒から。郵送に使います)'], ['person', '担当者'], ['phone', '電話'], ['email', 'メール'], ['line', 'LINE'],
]);
const KEYS = SEIKYUSAKI_FIELDS.map(([k]) => k);
const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 300) : '');

function newId() {
  const b = new Uint8Array(8); globalThis.crypto.getRandomValues(b);
  return `sk${[...b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
}

export function listSeikyusaki() { return (load().seikyusaki ?? []).slice(); }

/** 新しく入れる、または直す。会社名は要る。 */
export function saveSeikyusaki(input) {
  const rec = {};
  for (const k of KEYS) rec[k] = clean(input?.[k]);
  if (!rec.company) throw new Error('会社名を入れてください。');
  if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) throw new Error('メールの形を確かめてください。');
  const id = typeof input?.id === 'string' && /^sk[0-9a-f]{16}$/.test(input.id) ? input.id : newId();
  let saved;
  update(data => {
    data.seikyusaki ??= [];
    const i = data.seikyusaki.findIndex(s => s.id === id);
    saved = { id, ...rec, updated_at: Date.now() };
    if (i >= 0) data.seikyusaki[i] = { ...data.seikyusaki[i], ...saved };
    else data.seikyusaki.push(saved);
    return data;
  });
  return saved;
}

/** この現場の請求先を決める(null で外す)。 */
export function setProjectSeikyusaki(projectId, id) {
  update(data => {
    const p = data.projects.find(x => x.project_id === projectId);
    if (!p) throw new Error('現場が見つかりません。');
    if (id != null && !(data.seikyusaki ?? []).some(s => s.id === id)) throw new Error('請求先が見つかりません。');
    p.seikyusaki_id = id ?? null;
    return data;
  });
}

/** この現場の請求先。無ければ null。 */
export function seikyusakiOf(project, data = load()) {
  if (!project?.seikyusaki_id) return null;
  return (data.seikyusaki ?? []).find(s => s.id === project.seikyusaki_id) ?? null;
}

/** 請求書の宛先の形:〒の行と、住所の行、会社名 御中。 */
export function billingBlock(s) {
  if (!s) return null;
  const m = (s.address ?? '').match(/^〒?\s*(\d{3}-?\d{4})\s*(.*)$/);
  const postal = m ? `〒${m[1].replace(/^(\d{3})(\d{4})$/, '$1-$2')}` : '';
  const address = m ? m[2] : (s.address ?? '');
  return { postal, address, company: s.company, honorific: `${s.company}　御中`, person: s.person ?? '' };
}

/** 現場案内の封筒から、請求先の下書き(差出人の会社=請求先、担当・電話)。 */
export function seikyusakiFromEnvelope(env) {
  if (!env || env.kind !== 'genba') return null;
  return { company: env.from ?? '', address: '', person: env.site?.contact ?? '', phone: env.site?.contact_phone ?? '', email: '', line: '' };
}
