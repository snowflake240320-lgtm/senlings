// fillInvoiceWorkbook の試験。SheetJS 本体は CDN から読むので、ここでは同じ形の小さな代役で確かめる。
// (実際の Excel への書き出しと開いたときの見え方は、端末で確かめる)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillInvoiceWorkbook, DATA_SHEET, LEDGER_SHEET } from '../web/src/pwa/invoiceExport.js';

const colName = c => { let s = ''; c++; while (c) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; } return s; };
const XLSX = {
  utils: {
    encode_cell: ({ c, r }) => `${colName(c)}${r + 1}`,
    decode_range: ref => { const [a, b] = ref.split(':'); const p = x => ({ c: x.match(/[A-Z]+/)[0].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1, r: Number(x.match(/\d+/)[0]) - 1 }); return { s: p(a), e: p(b ?? a) }; },
    encode_range: ({ s, e }) => `${colName(s.c)}${s.r + 1}:${colName(e.c)}${e.r + 1}`,
    aoa_to_sheet: aoa => ({ aoa }),
    book_append_sheet: (wb, ws, name) => { wb.Sheets[name] = ws; wb.SheetNames.push(name); },
  },
};
// テンプレートと同じ形:見本の会社情報と、見本の行(他社)が入っている
function template() {
  const ws = { '!ref': 'A1:Q114', F2: { v: '見本住所' }, K2: { v: '72130' }, K4: { v: '090-0000-0000' }, F6: { v: '見本の会社' }, C6: { v: '※会社名' },
    F10: { v: '202602' }, O11: { v: 0.1 }, B15: { v: '001' }, C15: { v: 2026 }, I15: { v: '見本の工事' }, M15: { v: 30000 },
    N15: { f: 'IF(M15="","",K15*M15)', v: 30000 }, B16: { v: '002' }, I16: { v: '見本の工事2' }, M16: { v: 60000 }, I18: { v: '見本4' } };
  return { SheetNames: ['使い方', DATA_SHEET, '合計請求書'], Sheets: { [DATA_SHEET]: ws, '使い方': {}, '合計請求書': {} } };
}
const ctx = (over = {}) => ({ year: 2026, month: 12, completionDay: 26, userName: '架空の職人', registration: 'T0000000000000', contactName: '架空担当',
  projectCode: '2026-0001-01', projectName: 'M1070 架空の店', amountExTax: 500000, taxRate: 0.1, deduction: 0, ledger: [], ...over });

test('columns follow the template header; sample company info and sample rows are cleared', () => {
  const wb = template(); const ws = wb.Sheets[DATA_SHEET];
  const out = fillInvoiceWorkbook(XLSX, wb, ctx());
  assert.equal(out.rows, 1);
  assert.equal(ws.C6.v, '※会社名', 'the label is not overwritten');
  assert.equal(ws.F10.v, '202612'); assert.equal(ws.O11.v, 0.1); assert.equal(ws.F6.v, '架空の職人'); assert.equal(ws.K6.v, 'T0000000000000');
  for (const a of ['F2', 'K2', 'K4', 'I16', 'M16', 'I18']) assert.equal(ws[a], undefined, `${a} cleared`);
  assert.equal(ws.B15.v, '001', 'serial number kept');
  assert.deepEqual(['C15', 'D15', 'E15', 'F15', 'G15', 'H15', 'I15', 'J15', 'K15', 'L15', 'M15'].map(a => ws[a].v),
    [2026, 12, 26, '架空の職人', '架空担当', '2026-0001-01', 'M1070 架空の店', '明細書1参照', 1, '式', 500000]);
  assert.deepEqual([ws.N15.v, ws.O15.v, ws.P15.v], [500000, 50000, 550000]);
  assert.match(ws.O15.f, /ROUNDDOWN\(N15\*\$O\$11,0\)/);
  assert.equal(wb.Sheets[LEDGER_SHEET], undefined, 'no ledger sheet without a deduction');
});

test('deduction is one line below, sales stay gross; the ledger goes to a separate sheet', () => {
  const wb = template(); const ws = wb.Sheets[DATA_SHEET];
  const ledger = [{ date: '2026-12-01', label: '駐車代(チケット20枚)', amount: 20000, payer: '架空建装', memo: '' }];
  const out = fillInvoiceWorkbook(XLSX, wb, ctx({ deduction: 20000, ledger }));
  assert.equal(out.rows, 2); assert.equal(out.net, 480000);
  assert.equal(ws.M15.v, 500000, 'sales row stays gross');
  assert.match(ws.J16.v, /立替の差し引き\(内訳は別紙「立替内訳」\)/);
  assert.deepEqual([ws.M16.v, ws.N16.v, ws.O16.v, ws.P16.v], [-20000, -20000, -2000, -22000]);
  const sheet = wb.Sheets[LEDGER_SHEET];
  assert.ok(wb.SheetNames.includes(LEDGER_SHEET));
  assert.deepEqual(sheet.aoa[4], ['2026-12-01', '駐車代(チケット20枚)', 20000, '架空建装', '']);
  assert.deepEqual(sheet.aoa.at(-1), ['', '合計', 20000]);
  // 二回書いても別紙は一枚
  fillInvoiceWorkbook(XLSX, wb, ctx({ deduction: 20000, ledger }));
  assert.equal(wb.SheetNames.filter(n => n === LEDGER_SHEET).length, 1);
});

test('a missing data sheet stops with a clear message', () => {
  assert.throws(() => fillInvoiceWorkbook(XLSX, { SheetNames: [], Sheets: {} }, ctx()), /請求データ入力/);
});
