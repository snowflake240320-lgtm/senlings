// shirase.js — 知らせ(遅れます・休みます)と、いざというとき(人が倒れた・火事)の文。
// 送るのは人。Senlings は文を下書きして、共有の画面(LINE など)・SMS・電話へ渡すだけ。既読も催促も、記録も持たない。
// 宛先は、この現場の担当(自分に頼んでくれた側)。越えない。
import { dayLabel } from './envelope.js';

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const fromMin = n => { const v = ((n % 1440) + 1440) % 1440; return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`; };
const line = (v, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** 表示用の時刻(9:05)。 */
export function showTime(t) {
  if (!HM.test(t ?? '')) throw new Error('時刻を確かめてください。');
  return fromMin(toMin(t));
}

/**
 * 余裕をみた到着(10-24 船長:Googleマップの到着 +10分、5分単位で切り上げ)。
 * 9:12 → 9:25 / 9:15 → 9:25 / 9:10 → 9:20
 */
export function yoyuu(mapsAt, margin = 10, step = 5) {
  if (!HM.test(mapsAt ?? '')) throw new Error('Googleマップの到着時刻を確かめてください。');
  return fromMin(Math.ceil((toMin(mapsAt) + margin) / step) * step);
}

/** 呼びかけ。担当の名前が無ければ「ご担当の方」。 */
export function atena(contact) {
  const c = line(contact, 100);
  if (!c) return 'ご担当の方';
  return /(さん|様|さま|殿)$/.test(c) ? c : `${c}さん`;
}

/** Googleマップの道案内(Maps URLs。無料、API キー無し)。住所が無ければ null。 */
export function mapsLink(address) {
  const a = line(address, 300);
  return a ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}` : null;
}

/**
 * 遅れますの文。
 * @param {object} o
 * @param {string} o.site      現場名
 * @param {string} [o.contact] 担当
 * @param {string} [o.me]      自分の呼び名
 * @param {string} [o.mapsAt]  Googleマップの到着(HH:MM)。あれば「余裕をみて」を添える
 * @param {string} [o.at]      自分で決めた到着(HH:MM)。mapsAt が無いとき
 * @param {boolean} [o.jiko]   事故渋滞
 * @param {string} [o.note]    一言
 */
export function okureText({ site, contact, me, mapsAt, at, jiko = false, note } = {}) {
  const name = line(site);
  if (!name) throw new Error('現場名がありません。');
  const lines = [`${atena(contact)}`, `${name}、${jiko ? '事故渋滞で' : ''}遅れます。すみません。`];
  if (mapsAt) lines.push(`Googleマップでは ${showTime(mapsAt)} 着、余裕をみて ${yoyuu(mapsAt)} ごろ着きます。`);
  else if (at) lines.push(`${showTime(at)} ごろ着きます。`);
  else throw new Error('着く時刻を入れてください。');
  if (line(note, 500)) lines.push(line(note, 500));
  if (line(me, 100)) lines.push(line(me, 100));
  return lines.join('\n');
}

/**
 * 休みますの文。理由は聞かない(書きたい人は一言に)。
 * @param {object} o
 * @param {string} o.site
 * @param {string} o.date   休む日(YYYY-MM-DD)
 * @param {string} o.today  今日(YYYY-MM-DD)
 * @param {string} [o.contact]
 * @param {string} [o.me]
 * @param {boolean} [o.kawari] 代わりを探していることを添える
 * @param {string} [o.note]
 */
export function yasumiText({ site, date, today, contact, me, kawari = false, note } = {}) {
  const name = line(site);
  if (!name) throw new Error('現場名がありません。');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('休む日を確かめてください。');
  const when = date === today ? '今日' : `${dayLabel(date)}`;
  const lines = [`${atena(contact)}`, `${when}の${name}、休ませてください。申し訳ありません。`];
  if (kawari) lines.push('代わりに入れる人を、こちらで当たっています。決まったら、また連絡します。');
  if (line(note, 500)) lines.push(line(note, 500));
  if (line(me, 100)) lines.push(line(me, 100));
  return lines.join('\n');
}

export const KINKYU = Object.freeze({
  taore: '人が倒れた',
  kaji: '火事',
});

/**
 * 速報の文(関係者へ。短く。名前より場所)。
 * @param {object} o
 * @param {'taore'|'kaji'} o.kind
 * @param {string} o.site
 * @param {string} [o.place] 棟・階・区画
 * @param {boolean} [o.aed]  AED も頼む(人が倒れたとき)
 * @param {string} [o.me]
 * @param {number} [o.now]
 */
export function sokuhouText({ kind, site, place, aed = true, me, now = Date.now() } = {}) {
  if (!Object.hasOwn(KINKYU, kind)) throw new Error('種類を確かめてください。');
  const d = new Date(now);
  const at = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const lines = [`【速報】${kind === 'taore' ? '人が倒れました' : '火事です'}(${at})`];
  if (line(site)) lines.push(`現場:${line(site)}`);
  lines.push(`場所:${line(place) || '(場所を書く)'}`);
  if (kind === 'taore' && aed) lines.push('AED を持ってきてください。119 をお願いします。');
  if (kind === 'kaji') lines.push('近くの人は逃げてください。119 をお願いします。');
  if (line(me, 100)) lines.push(line(me, 100));
  return lines.join('\n');
}

/** 服に火がついた人(10-24 船長の言葉のまま)。 */
export const FUKU_NI_HI = '消火器で、すぐ消す。人に向けていい。無ければスパッタシートで覆う。油や溶剤が付いた服に、水はかけない。';

/** SMS の下書きへのリンク(iPhone・Android の両方で開く形)。番号が無ければ null。 */
export function smsLink(phone, text) {
  if (!phone) return null;
  return `sms:${phone}?&body=${encodeURIComponent(text)}`;
}
