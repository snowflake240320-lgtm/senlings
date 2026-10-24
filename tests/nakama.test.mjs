import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ponRows, ponTotal, ponText, setPonRate, addPonExtra, togglePonRow, addPonTickets, editPonAmount, ponLedgerRows, setTrades, hooText, keroText,
  recordSent, markReturned, konReminderText, readNakama, localDate, HOO_TRADES } from '../web/src/pwa/nakama.js';
import { load } from '../web/src/pwa/storage.js';

process.env.TZ = 'Asia/Tokyo';
const at = (d, h = 9) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00+09:00`).getTime();
const fixture = () => ({
  projects: [{ project_id: 'a', project_slug: '架空A' }, { project_id: 'b', project_slug: '架空B' }],
  work_sessions: [
    { id: '1', project_id: 'a', check_in_at: at('2026-12-01'), check_out_at: at('2026-12-01', 17), break_minutes: 0 },
    { id: '2', project_id: 'a', check_in_at: at('2026-12-01', 13), check_out_at: at('2026-12-01', 16), break_minutes: 0 },
    { id: '3', project_id: 'a', check_in_at: at('2026-12-02'), check_out_at: at('2026-12-02', 17), break_minutes: 0 },
    { id: '4', project_id: 'b', check_in_at: at('2026-12-02'), check_out_at: at('2026-12-02', 17), break_minutes: 0 },
    { id: '5', project_id: 'a', check_in_at: at('2026-11-30'), check_out_at: at('2026-11-30', 17), break_minutes: 0 },
  ],
  expenses: [{ id: 'e', project_id: 'a', expense_date: '2026-12-01', category: 'parking', amount: 500 }],
  future: { keep: true },
});
function storage(data = fixture()) {
  const mock = { raw: JSON.stringify(data), writes: 0,
    getItem(k) { return k === 'senlings_v0' ? this.raw : null; },
    setItem(k, raw) { assert.equal(k, 'senlings_v0'); this.raw = raw; this.writes++; } };
  globalThis.localStorage = mock; return mock;
}

test('pon: no rate, no rows; nothing is written just by reading', () => {
  const s = storage();
  assert.deepEqual(ponRows(load(), '2026-12'), []);
  assert.equal(s.writes, 0);
});

test('pon: parking comes from tickets received, not from the days on site', () => {
  storage(); setPonRate('a', { parking_per_day: '1000', payer: '架空建装' });
  assert.deepEqual(ponRows(load(), '2026-12'), [], 'days on site alone make no parking row');
  assert.throws(() => addPonTickets({ id: 't0', date: '2026-12-01', project_id: 'b', count: 5 }), /単価/);
  addPonTickets({ id: 't1', date: '2026-12-01', project_id: 'a', count: '20' });
  addPonTickets({ id: 't1', date: '2026-12-01', project_id: 'a', count: '20' });   // 同じIDは一回だけ
  addPonTickets({ id: 't2', date: '2026-11-28', project_id: 'a', count: 3 });       // 先月分は入らない
  const rows = ponRows(load(), '2026-12');
  assert.deepEqual(rows.map(r => [r.date, r.count, r.amount, r.payer]), [['2026-12-01', 20, 20000, '架空建装']]);
  assert.match(rows[0].source, /チケット 20枚 × 1,000円/);
  // 単価をあとで変えても、受け取った日の単価のまま
  setPonRate('a', { parking_per_day: 1200, payer: '架空建装' });
  assert.equal(ponTotal(ponRows(load(), '2026-12')), 20000);
});

test('pon: amount can be corrected in place; the original stays and can be restored', () => {
  const s = storage(); setPonRate('a', { parking_per_day: 1000 });
  addPonTickets({ id: 't1', date: '2026-12-01', project_id: 'a', count: 20 });
  addPonExtra({ id: 'x', date: '2026-12-02', project_id: 'a', kind: 'overtime', amount: '8000', memo: '17-19時' });
  addPonExtra({ id: 'x', date: '2026-12-02', project_id: 'a', kind: 'overtime', amount: '8000' });
  editPonAmount('ticket:t1', '19000');
  let rows = ponRows(load(), '2026-12');
  const t = rows.find(r => r.key === 'ticket:t1');
  assert.deepEqual([t.amount, t.original, t.edited], [19000, 20000, true]);
  assert.equal(ponTotal(rows), 27000);
  togglePonRow('extra:x'); assert.equal(ponTotal(ponRows(load(), '2026-12')), 19000);
  togglePonRow('extra:x');
  editPonAmount('ticket:t1', ''); rows = ponRows(load(), '2026-12');
  assert.deepEqual([rows.find(r => r.key === 'ticket:t1').amount, rows.find(r => r.key === 'ticket:t1').edited], [20000, false]);
  assert.throws(() => editPonAmount('ticket:t1', '-5'), /金額/);
  const data = JSON.parse(s.raw);
  assert.deepEqual(data.expenses, fixture().expenses); assert.deepEqual(data.future, { keep: true });
  assert.match(ponText(rows, '2026-12', '架空の職人'), /立替の内訳（2026年12月分）[\s\S]*駐車代\(チケット20枚\)　20,000円[\s\S]*時間外の負担金　8,000円　17-19時[\s\S]*合計　28,000円/);
  assert.deepEqual(ponLedgerRows(rows).map(r => [r.label, r.amount]), [['駐車代(チケット20枚)', 20000], ['時間外の負担金', 8000]]);
});

test('pon: bad input is refused and nothing is written', () => {
  const s = storage();
  assert.throws(() => setPonRate('zzz', { parking_per_day: 1000 }), /現場が見つかりません/);
  assert.throws(() => setPonRate('a', { parking_per_day: '-1' }), /金額/);
  assert.throws(() => addPonExtra({ id: 'y', date: '12/2', project_id: 'a', kind: 'overtime', amount: 1 }), /日付/);
  assert.throws(() => addPonExtra({ id: 'y', date: '2026-12-02', project_id: 'a', kind: 'parking', amount: 1 }), /種類/);
  assert.equal(s.writes, 0);
});

test('malformed nakama data stops without overwriting', () => {
  const s = storage({ ...fixture(), nakama: { pon: { extra: 'broken' } } });
  const before = s.raw;
  assert.throws(() => readNakama(), /読み取れません/);
  assert.throws(() => setTrades(['naiso']), /読み取れません/);
  assert.equal(s.raw, before); assert.equal(s.writes, 0);
});

test('malformed fields (a rate as text, an extra row without a date) stop too; strings are trimmed', () => {
  for (const nakama of [
    { pon: { rates: { a: { parking_per_day: '1000' } } } },
    { pon: { extra: [{ id: 'x', project_id: 'a', kind: 'overtime', amount: 100 }] } },
    { kon: { sent: [{ id: 's', at: '2026-12-01', what: 5 }] } },
    { pon: { tickets: [{ id: 't', date: '2026-12-01', project_id: 'a', count: 1.5, unit_price: 1000 }] } },
    { pon: { edits: { 'ticket:t': '900' } } },
  ]) {
    const s = storage({ ...fixture(), nakama });
    assert.throws(() => ponRows(load(), '2026-12'), /読み取れません/);
    assert.equal(s.writes, 0);
  }
  storage(); setPonRate('a', { parking_per_day: 1000, payer: '  架空建装  ' });
  recordSent({ id: 's', at: '2026-12-01', what: '  搬出入届 ', to: ' 架空統括 ' });
  assert.equal(readNakama().pon.rates.a.payer, '架空建装');
  assert.deepEqual([readNakama().kon.sent[0].what, readNakama().kon.sent[0].to], ['搬出入届', '架空統括']);
});

test('hoo: items follow the chosen trades only', () => {
  storage(); setTrades(['denki', 'unknown', 'denki']);
  assert.deepEqual(readNakama().trades, ['denki']);
  const text = hooText({ project: { project_slug: '架空A' }, trades: readNakama().trades, photoCount: 2, date: '2026-12-02' });
  for (const item of HOO_TRADES.denki.items) assert.ok(text.includes(item));
  assert.ok(!text.includes(HOO_TRADES.naiso.items[0]));
  assert.match(text, /写真：2枚/);
});

test('kero: a KY draft with blanks for the craftsman', () => {
  const text = keroText({ project: { project_slug: '架空A' }, date: '2026-12-02', userName: '架空の職人', trades: ['naiso'] });
  assert.match(text, /架空A[\s\S]*架空の職人　職種：内装・大工[\s\S]*危ないところ：/);
});

test('kon: a plain record of what was handed over, a gentle reminder, no counting', () => {
  storage();
  recordSent({ id: 's1', at: '2026-12-01', what: '搬出入届', to: '架空統括', project_id: 'a' });
  recordSent({ id: 's1', at: '2026-12-01', what: '搬出入届' });
  assert.equal(readNakama().kon.sent.length, 1);
  markReturned('s1', true); assert.ok(readNakama().kon.sent[0].returned_at);
  markReturned('s1', false); assert.equal(readNakama().kon.sent[0].returned_at, null);
  const text = konReminderText(readNakama().kon.sent[0]);
  assert.match(text, /架空統括さん[\s\S]*12月1日にお渡しした「搬出入届」/);
  assert.doesNotMatch(text, /至急|期限切れ|遅れ/);
  assert.throws(() => recordSent({ id: 's2', at: '', what: '' }), /渡した日/);
});

test('localDate uses the phone clock, not UTC', () => {
  assert.equal(localDate(new Date('2026-12-01T00:30:00+09:00').getTime()), '2026-12-01');
});
