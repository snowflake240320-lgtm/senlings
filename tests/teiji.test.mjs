// 今日の現場と定時(2026-10-25)。出勤は押さない。今日の現場が決まれば定時で一日。
// 残業は「残業おつかれさま」を押した日だけ。これまでの入った/出たの記録はそのまま数える。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeTeiji, removeTeiji, markOvertime, setOvertime, setProjectTeiji, teijiOn, teijiOf, monthlySummary, calcWorkMinutes,
  overtimePay, localDate, addDays, sessionDate, buildDailyBreakdown } from '../web/src/pwa/work.js';
import { setPonRate, ponRows, ponTotal, ponOvertimeWithoutRate } from '../web/src/pwa/nakama.js';
import { read, load, StorageReadError } from '../web/src/pwa/storage.js';
import { fillInvoiceWorkbook, DATA_SHEET } from '../web/src/pwa/invoiceExport.js';

process.env.TZ = 'Asia/Tokyo';
const at = (d, h = 9, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`).getTime();
const fixture = () => ({
  projects: [{ project_id: 'a', project_slug: '架空A' }, { project_id: 'b', project_slug: '架空B', teiji: { start: '08:30', end: '17:30' } }],
  work_sessions: [
    { id: 'old', project_id: 'a', check_in_at: at('2026-12-01', 7, 40), check_out_at: at('2026-12-01', 18), break_minutes: 0 },
  ],
  future: { keep: true },
});
function storage(data = fixture()) {
  const mock = { raw: JSON.stringify(data), writes: 0,
    getItem(k) { return k === 'senlings_v0' ? this.raw : null; },
    setItem(k, raw) { assert.equal(k, 'senlings_v0'); this.raw = raw; this.writes++; } };
  globalThis.localStorage = mock; return mock;
}

test('teiji: choosing today\'s site places one day at the site rule (or 8:00-17:00); pressed times are not used', () => {
  storage();
  const s = placeTeiji('a', '2026-12-02');
  assert.equal(s.kind, 'teiji'); assert.equal(s.date, '2026-12-02');
  assert.equal(s.check_in_at, at('2026-12-02', 8)); assert.equal(s.check_out_at, at('2026-12-02', 17));
  assert.equal(calcWorkMinutes(s), 8 * 60, '9時間から昼の一時間');
  const b = placeTeiji('b', '2026-12-03');
  assert.equal(b.check_in_at, at('2026-12-03', 8, 30)); assert.equal(b.check_out_at, at('2026-12-03', 17, 30));
  assert.deepEqual(load().future, { keep: true }, 'unknown fields survive');
});

test('teiji: one day is one day. Choosing again moves it; overtime does not follow to another site', () => {
  storage();
  placeTeiji('a', '2026-12-02');
  markOvertime('2026-12-02', at('2026-12-02', 18));
  placeTeiji('a', '2026-12-02');
  assert.equal(teijiOn(load(), '2026-12-02').overtime_minutes, 60, 'same site keeps overtime');
  placeTeiji('b', '2026-12-02');
  const moved = teijiOn(load(), '2026-12-02');
  assert.equal(moved.project_id, 'b'); assert.equal(moved.overtime_minutes, 0);
  assert.equal(load().work_sessions.filter(s => s.kind === 'teiji').length, 1);
  removeTeiji('2026-12-02');
  assert.equal(teijiOn(load(), '2026-12-02'), null);
  assert.throws(() => placeTeiji('nope', '2026-12-02'), /現場が見つかりません/);
  assert.throws(() => placeTeiji('a', '12/2'), /日付/);
});

test('overtime: only when pressed, after the end of the day, in 30-minute steps rounded up; the longer press stays', () => {
  storage();
  placeTeiji('a', '2026-12-02');
  assert.equal(teijiOn(load(), '2026-12-02').overtime_minutes, 0, 'not pressed, no overtime');
  assert.throws(() => markOvertime('2026-12-02', at('2026-12-02', 16, 59)), /終業のあと/);
  assert.equal(markOvertime('2026-12-02', at('2026-12-02', 17, 1)), 30);
  assert.equal(markOvertime('2026-12-02', at('2026-12-02', 18, 40)), 120);
  assert.equal(markOvertime('2026-12-02', at('2026-12-02', 17, 10)), 120, 'an earlier press does not shorten it');
  setOvertime('2026-12-02', 0);
  assert.equal(teijiOn(load(), '2026-12-02').overtime_minutes, 0);
  assert.throws(() => setOvertime('2026-12-02', 45), /30分刻み/);
  assert.throws(() => markOvertime('2026-12-09', at('2026-12-09', 19)), /今日の現場がありません/);
});

test('site rule: fixing the hours re-places today and later days, keeps past days and overtime', () => {
  storage();
  placeTeiji('a', '2026-12-01'); placeTeiji('a', '2026-12-02'); placeTeiji('a', '2026-12-03');
  markOvertime('2026-12-02', at('2026-12-02', 17, 20));
  setProjectTeiji('a', '07:30', '16:30', '2026-12-02');
  const d = load();
  assert.equal(teijiOn(d, '2026-12-01').check_in_at, at('2026-12-01', 8), 'yesterday stays as it was');
  assert.equal(teijiOn(d, '2026-12-02').check_in_at, at('2026-12-02', 7, 30));
  assert.equal(teijiOn(d, '2026-12-02').overtime_minutes, 30);
  assert.equal(teijiOn(d, '2026-12-03').check_out_at, at('2026-12-03', 16, 30));
  assert.deepEqual(teijiOf(d.projects[0]), { start: '07:30', end: '16:30', rule: true });
  assert.throws(() => setProjectTeiji('a', '17:00', '08:00'), /始業と終業/);
  assert.throws(() => setProjectTeiji('a', '8:00', '17:00'), /始業と終業/);
});

test('month: days are counted by date (an old entry and a teiji day on the same date are one day); billed overtime is only pressed overtime', () => {
  storage();
  placeTeiji('a', '2026-12-01');   // 同じ日に古い入った/出たの記録がある
  placeTeiji('a', '2026-12-02');
  placeTeiji('b', '2026-12-03');
  markOvertime('2026-12-02', at('2026-12-02', 18, 30));
  const m = monthlySummary('a', 2026, 12);
  assert.equal(m.total_days, 2);
  assert.equal(m.overtime_minutes, 90, 'the old 10h20m entry is not billed as overtime');
  assert.equal(m.sessions.length, 3);
  assert.deepEqual(buildDailyBreakdown(m.sessions).map(r => r.date), ['2026-12-01', '2026-12-02']);
  assert.equal(overtimePay(90, 24000), 5625, '24,000/8 × 1.25 × 1.5h');
});

test('dates are the device calendar, not UTC (8:00 in Tokyo is still the same day)', () => {
  assert.equal(localDate(at('2026-12-01', 8)), '2026-12-01');
  assert.equal(sessionDate({ check_in_at: at('2026-12-01', 7) }), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('pon: overtime lines come from pressed overtime, only where an hourly rate was entered', () => {
  storage();
  placeTeiji('a', '2026-12-02'); markOvertime('2026-12-02', at('2026-12-02', 18));
  placeTeiji('b', '2026-12-03'); markOvertime('2026-12-03', at('2026-12-03', 18));
  assert.deepEqual(ponRows(load(), '2026-12'), []);
  assert.equal(ponOvertimeWithoutRate(load(), '2026-12'), true);
  setPonRate('a', { parking_per_day: 1000, overtime_per_hour: '4000', payer: '架空建装' });
  const rows = ponRows(load(), '2026-12');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'overtime'); assert.equal(rows[0].amount, 4000); assert.equal(rows[0].key, 'zangyo:teiji:2026-12-02');
  assert.equal(ponTotal(rows, 'a'), 4000);
  setPonRate('a', { parking_per_day: 1000, payer: '架空建装' });
  assert.equal(ponRows(load(), '2026-12')[0].unit_price, 4000, 'leaving the hourly rate out keeps it');
});

test('storage: a broken teiji shape stops reading and is never repaired', () => {
  for (const bad of [
    { kind: 'other' },
    { kind: 'teiji', date: '12/2' },
    { kind: 'teiji', date: '2026-12-02', overtime_minutes: -30 },
    { kind: 'teiji', date: '2026-12-02', overtime_minutes: 'x' },
  ]) {
    const d = fixture(); d.work_sessions.push({ id: 'x', project_id: 'a', check_in_at: at('2026-12-02'), check_out_at: at('2026-12-02', 17), break_minutes: 60, ...bad });
    const m = storage(d);
    assert.equal(read().status, 'unreadable');
    assert.throws(() => placeTeiji('a', '2026-12-05'), StorageReadError);
    assert.equal(m.writes, 0);
  }
  const twice = fixture();
  for (const id of ['x', 'y']) twice.work_sessions.push({ id, kind: 'teiji', date: '2026-12-02', project_id: 'a', check_in_at: at('2026-12-02'), check_out_at: at('2026-12-02', 17), break_minutes: 60 });
  storage(twice); assert.equal(read().status, 'unreadable', 'one day is one day');
  const rule = fixture(); rule.projects[0].teiji = { start: '8:00', end: '17:00' };
  storage(rule); assert.equal(read().status, 'unreadable');
});

test('invoice: an overtime line sits under the days, before the deduction', () => {
  const ws = { '!ref': 'A1:Q114', O11: { v: 0.1 } };
  const wb = { SheetNames: [DATA_SHEET], Sheets: { [DATA_SHEET]: ws } };
  const colName = c => String.fromCharCode(65 + c);
  const XLSX = { utils: {
    encode_cell: ({ c, r }) => `${colName(c)}${r + 1}`,
    decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 113, c: 16 } }),
    encode_range: () => 'A1:Q114',
    aoa_to_sheet: aoa => ({ aoa }), book_append_sheet: (b, s, n) => { b.Sheets[n] = s; b.SheetNames.push(n); } } };
  const out = fillInvoiceWorkbook(XLSX, wb, { year: 2026, month: 12, completionDay: 26, userName: '架空', registration: '', contactName: '', projectCode: '', projectName: '架空A',
    amountExTax: 48000, overtime: { label: '残業 1時間30分(30分刻み)', amount: 5625 }, taxRate: 0.1, deduction: 4000, ledger: [{ date: '2026-12-02', label: '時間外', amount: 4000, payer: '', memo: '' }] });
  assert.equal(out.rows, 3);
  assert.equal(ws.J16.v, '残業 1時間30分(30分刻み)'); assert.equal(ws.M16.v, 5625);
  assert.equal(ws.M17.v, -4000);
  assert.equal(out.net, 48000 + 5625 - 4000);
});
