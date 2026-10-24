// nakama.js — 仲間(ポン・コン・ケロ・ホー)の芯。画面に依らない。
//
// 仲間は、職人のスマホに残った事実から「出す書類の下書き」を作る。
// - 作るのは下書きまで。出すかどうか・誰に出すかは職人が決める。
// - 報告しない。点数を付けない。数えて評価しない。元請けには見えない。
// - 施設の書式・単価はコードに書かない(施設の許しが出てから、届けで入る)。
//
// 保存は data.nakama に置く(無ければ空として読む)。形が崩れていたら書かずに止める。

import { load, update } from './storage.js';

export const PON_KINDS = Object.freeze({
  parking:  '駐車代',
  overtime: '時間外の負担金',
  elv:      'エレベーターの使用料',
  other:    'その他の立替',
});

// ホーの下書きの項目。施設の原文ではなく、職種ごとの一般的な見どころ。
// 施設のチェックリストは、許しが出てから施設の届けとして重ねる。
export const HOO_TRADES = Object.freeze({
  naiso: { label: '内装・大工', items: ['点検口の位置・開き勝手・脚立が立つか', '什器・棚の固定', '手の届く角・端部の処理', '防煙垂壁・設備との離隔'] },
  denki: { label: '電気', items: ['盤の締付確認(一回目・二回目)', '回路表示と図面の一致', 'コンセントの番号', '照明・吊物の振れ止め'] },
  setsubi: { label: '設備', items: ['排水の勾配', '漏水検知器と表示器の位置', '給水の保温', 'ダクトの点検口'] },
  bosui: { label: '防水', items: ['立上りの高さ', '水張りの結果', '目皿の水抜き'] },
});

const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const yen = n => `${Math.round(n).toLocaleString('ja-JP')}円`;

export function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const str = (v, max) => typeof v === 'string' && v.length <= max;
const money = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000_000;
const dateStr = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const list = (v, ok) => v == null || (Array.isArray(v) && v.every(ok));

// 読めない形は、直さずに止める(保存の作法と同じ)。数は数、文字は文字。
export function nakamaOf(data) {
  const n = data.nakama ?? {};
  const pon = record(n) ? (n.pon ?? {}) : null;
  const kon = record(n) ? (n.kon ?? {}) : null;
  const ok = record(n) && record(pon) && record(kon)
    && (pon.rates == null || (record(pon.rates) && Object.values(pon.rates).every(r => record(r) && money(r.parking_per_day) && str(r.payer ?? '', 100))))
    && list(pon.extra, r => record(r) && str(r.id, 100) && dateStr(r.date) && str(r.project_id, 200)
        && Object.hasOwn(PON_KINDS, r.kind) && money(r.amount) && str(r.memo ?? '', 200))
    && list(pon.tickets, t => record(t) && str(t.id, 100) && dateStr(t.date) && str(t.project_id, 200)
        && Number.isSafeInteger(t.count) && t.count > 0 && t.count <= 1000 && money(t.unit_price) && str(t.memo ?? '', 200))
    && (pon.edits == null || (record(pon.edits) && Object.values(pon.edits).every(money)))
    && list(pon.skip, k => typeof k === 'string')
    && list(n.trades, t => typeof t === 'string')
    && list(kon.sent, s => record(s) && str(s.id, 100) && dateStr(s.at) && str(s.what, 200) && str(s.to ?? '', 100)
        && (s.returned_at == null || dateStr(s.returned_at)));
  if (!ok) throw new Error('仲間の記録が読み取れません。書き換えずに止めました。');
  return {
    pon: { rates: pon.rates ?? {}, tickets: pon.tickets ?? [], extra: pon.extra ?? [], edits: pon.edits ?? {}, skip: pon.skip ?? [] },
    trades: n.trades ?? [],
    kon: { sent: kon.sent ?? [] },
  };
}

function writeNakama(fn) {
  return update(data => {
    const n = nakamaOf(data);
    fn(n, data);
    data.nakama = { ...(record(data.nakama) ? data.nakama : {}), pon: n.pon, trades: n.trades, kon: n.kon };
    return data;
  });
}

const amount = v => {
  if (v === '' || v == null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new Error('金額を確かめてください。');
  return Math.round(n);
};

// ── ポン:元請けが立て替えた分の内訳(請求から差し引く) ─────────────
// いまの経費(職人が払って請求に足す)とは向きが逆。混ぜない。

export function setPonRate(projectId, { parking_per_day, payer }) {
  return writeNakama((n, data) => {
    if (!data.projects.some(p => p.project_id === projectId)) throw new Error('現場が見つかりません。');
    n.pon.rates = { ...n.pon.rates, [projectId]: { parking_per_day: amount(parking_per_day), payer: String(payer ?? '').trim().slice(0, 100) } };
  });
}

export function addPonExtra({ id, date, project_id, kind, amount: value, memo }) {
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Object.hasOwn(PON_KINDS, kind) || kind === 'parking') throw new Error('日付と種類を確かめてください。');
  const a = amount(value);
  if (a <= 0) throw new Error('金額を入れてください。');
  return writeNakama((n, data) => {
    if (!data.projects.some(p => p.project_id === project_id)) throw new Error('現場が見つかりません。');
    if (n.pon.extra.some(r => r.id === id)) return;
    n.pon.extra = [...n.pon.extra, { id, date, project_id, kind, amount: a, memo: String(memo ?? '').trim().slice(0, 200), created_at: Date.now() }];
  });
}

// 外した行も消さない。戻せる。
export function togglePonRow(key) {
  return writeNakama(n => {
    n.pon.skip = n.pon.skip.includes(key) ? n.pon.skip.filter(k => k !== key) : [...n.pon.skip, key];
  });
}

// 駐車代は「受け取ったチケット」から(会社が「誰に何枚」で分けているのと同じもの)。
// 現場に入った日からは作らない。突き合わせを生まないため。
export function addPonTickets({ id, date, project_id, count, memo }) {
  const c = Number(count);
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isSafeInteger(c) || c <= 0 || c > 1000) throw new Error('受け取った日と枚数を確かめてください。');
  return writeNakama((n, data) => {
    if (!data.projects.some(p => p.project_id === project_id)) throw new Error('現場が見つかりません。');
    const rate = n.pon.rates[project_id];
    if (!rate || !(rate.parking_per_day > 0)) throw new Error('先に、この現場のチケット1枚の単価を入れてください。');
    if (n.pon.tickets.some(t => t.id === id)) return;
    n.pon.tickets = [...n.pon.tickets, { id, date, project_id, count: c, unit_price: rate.parking_per_day, memo: String(memo ?? '').trim().slice(0, 200), created_at: Date.now() }];
  });
}

// 行の金額を直す。元の金額は消さない(original に残り、画面にも出る)。空なら元に戻す。
export function editPonAmount(key, value) {
  const restore = value === '' || value == null;
  const a = restore ? null : amount(value);
  return writeNakama(n => {
    const edits = { ...n.pon.edits };
    if (restore) delete edits[key]; else edits[key] = a;
    n.pon.edits = edits;
  });
}

export function ponRows(data, ym) {
  const n = nakamaOf(data);
  const names = Object.fromEntries((data.projects ?? []).map(p => [p.project_id, p.project_slug]));
  const rows = [];
  for (const t of n.pon.tickets) {
    if (!t.date.startsWith(ym)) continue;
    rows.push({ key: `ticket:${t.id}`, date: t.date, project_id: t.project_id, project: names[t.project_id] ?? t.project_id, kind: 'parking',
      original: t.count * t.unit_price, count: t.count, unit_price: t.unit_price, payer: n.pon.rates[t.project_id]?.payer || '',
      source: `受け取ったチケット ${t.count}枚 × ${yen(t.unit_price)}`, memo: t.memo ?? '' });
  }
  for (const r of n.pon.extra) {
    if (!r.date.startsWith(ym)) continue;
    rows.push({ key: `extra:${r.id}`, date: r.date, project_id: r.project_id, project: names[r.project_id] ?? r.project_id, kind: r.kind,
      original: r.amount, payer: n.pon.rates[r.project_id]?.payer || '', source: '自分で足した行', memo: r.memo ?? '' });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  return rows.map(r => {
    const edited = Object.hasOwn(n.pon.edits, r.key);
    return { ...r, amount: edited ? n.pon.edits[r.key] : r.original, edited, skipped: n.pon.skip.includes(r.key) };
  });
}

export function ponTotal(rows, projectId) {
  return rows.filter(r => !r.skipped && (!projectId || r.project_id === projectId)).reduce((t, r) => t + r.amount, 0);
}

export function ponLabel(r) {
  return `${PON_KINDS[r.kind]}${r.count ? `(チケット${r.count}枚)` : ''}`;
}

// 別紙と取り込みファイル(CSV)に渡す行。外した行は入れない。
// 勘定科目と消費税の扱いは税理士さんの答え待ちなので、決めつけずに空けておく。
export function ponLedgerRows(rows) {
  return rows.filter(r => !r.skipped).map(r => ({
    date: r.date, project: r.project, project_id: r.project_id, label: ponLabel(r), amount: r.amount, payer: r.payer, memo: r.memo,
  }));
}

export function ponText(rows, ym, userName) {
  const live = rows.filter(r => !r.skipped);
  const lines = [`立替の内訳（${ym.replace('-', '年')}月分）`, userName ? `作成：${userName}` : null, ''];
  for (const r of live) lines.push(`${r.date}　${r.project}　${ponLabel(r)}　${yen(r.amount)}${r.memo ? `　${r.memo}` : ''}`);
  lines.push('', `合計　${yen(ponTotal(live))}`, '', '※この端末の記録から作った下書きです。違う行は直してからお使いください。');
  return lines.filter(l => l !== null).join('\n');
}

// ── ケロ:安全の書類の下書き(KY) ─────────────────────────────

export function keroText({ project, date, userName, trades }) {
  const tradeNames = trades.map(t => HOO_TRADES[t]?.label).filter(Boolean).join('・');
  return [
    `危険予知(KY)の下書き　${date}`,
    `現場：${project?.project_slug ?? '（現場を選んでください）'}`,
    `名前：${userName || '（設定で名前を入れると入ります）'}${tradeNames ? `　職種：${tradeNames}` : ''}`,
    '',
    '今日の作業：',
    '危ないところ：',
    'こうして防ぐ：',
    '火気・危険物を使うか：　使う ／ 使わない',
    '',
    '※下書きです。現場の書式があれば、そちらに写してください。',
  ].join('\n');
}

// ── ホー:検査・是正・完了の書類の下書き(職種で変わる) ─────────────

export function setTrades(trades) {
  const clean = [...new Set(trades)].filter(t => Object.hasOwn(HOO_TRADES, t));
  return writeNakama(n => { n.trades = clean; });
}

export function hooText({ project, trades, photoCount, userName, date }) {
  const lines = [`完了の確かめ(下書き)　${date}`, `現場：${project?.project_slug ?? '（現場を選んでください）'}`];
  if (userName) lines.push(`名前：${userName}`);
  if (!trades.length) lines.push('', '職種を選ぶと、見どころが入ります。');
  for (const t of trades) {
    const trade = HOO_TRADES[t];
    if (!trade) continue;
    lines.push('', `■ ${trade.label}`);
    for (const item of trade.items) lines.push(`□ ${item}　：`);
  }
  lines.push('', `この現場で残した写真：${photoCount}枚(この端末の中)`, '', '※下書きです。施設のチェックリストがあれば、そちらが正です。');
  return lines.join('\n');
}

// ── コン:期限と戻り。渡したことの控えと、戻りのお願いの下書き ──────────
// 期限切れの赤・催促・数え上げは持たない。控えは事実だけ。

export function recordSent({ id, at, what, to, project_id }) {
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(at ?? '') || !String(what ?? '').trim()) throw new Error('渡した日と、何を渡したかを入れてください。');
  return writeNakama(n => {
    if (n.kon.sent.some(s => s.id === id)) return;
    n.kon.sent = [...n.kon.sent, { id, at, what: String(what).trim().slice(0, 200), to: String(to ?? '').trim().slice(0, 100), project_id: project_id ?? null, created_at: Date.now() }];
  });
}

export function markReturned(id, on) {
  return writeNakama(n => {
    n.kon.sent = n.kon.sent.map(s => s.id === id ? { ...s, returned_at: on ? localDate(Date.now()) : null } : s);
  });
}

export function konReminderText(entry) {
  const [, m, d] = entry.at.split('-').map(Number);
  return `${entry.to ? `${entry.to}さん\n` : ''}お疲れさまです。${m}月${d}日にお渡しした「${entry.what}」の件、戻りはいつ頃になりそうでしょうか。わかる範囲で教えてもらえると助かります。`;
}

export function readNakama() {
  return nakamaOf(load());
}
