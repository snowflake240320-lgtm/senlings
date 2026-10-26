/**
 * invoiceExport.js — Excelエクスポート
 * 藤田建装指定テンプレートへの当月データ自動入力
 *
 * SheetJS は CDN ESM 版を動的 import（バンドラー不要、firebase.js と同方式）。
 * iOS PWA 対応: Blob + anchor click でダウンロード。
 *
 * 2026-10-24(維新):
 * - 列をテンプレートの見出し(12行目)に合わせ直した。以前は一列ずれていた
 *   (年を「連番」に、請求年月を「会社名」の見出しに書いていた)。
 * - テンプレートに残っていた見本の行・見本の会社情報は、書き出すときに空ける。
 * - ポンの立替を「差し引き(立替)」の一行で載せ、内訳は別紙「立替内訳」に置く。売上は総額のまま。
 *   差し引きの行の消費税は、テンプレートの式のまま計算される(扱いは税理士さんに確かめる)。
 */

import { load } from "./storage.js";
import { monthlySummary, overtimePay, formatMinutes } from "./work.js";
import { monthlyExpenseSummary } from "./expenseQuery.js";
import { getSetting, SETTINGS_KEYS } from './settings.js';
import { seikyusakiOf, billingBlock } from './seikyusaki.js';
import { ClaimStatus } from "./expense.js";
import { ponRows, ponTotal, ponLedgerRows } from "./nakama.js";

const XLSX_CDN      = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
const TEMPLATE_PATH = "/public/templates/Invoice_Gen_WithDetails.xlsx";
export const DATA_SHEET   = "請求データ入力";
export const LEDGER_SHEET = "立替内訳";
const FIRST_ROW = 15;   // 1-indexed。12行目が見出し、14行目が記入例、15行目(連番001)から
const LAST_ROW  = 114;  // 連番100
// 列(0-indexed):B 連番 / C 年 / D 月 / E 日 / F 御社ご担当者名 / G 藤田建装担当者 / H 工事コード / I 工事名 /
//               J 内容 / K 数量 / L 単価単位 / M 単価 / N 金額(税抜・式) / O 消費税(式) / P 金額(税込・式)
const COL = { year: 2, month: 3, day: 4, user: 5, contact: 6, code: 7, name: 8, detail: 9, qty: 10, unit: 11, price: 12, net: 13, tax: 14, gross: 15 };

function getUnitPrice() {
  const v = getSetting(SETTINGS_KEYS.WORK_UNIT_PRICE);
  return v ? Number(v) : 25000;
}

function getTaxRate() {
  const v = Number(getSetting(SETTINGS_KEYS.TAX_RATE));
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.1;
}

const trunc = n => (n < 0 ? Math.ceil(n) : Math.floor(n)); // ROUNDDOWN(x, 0) と同じ(0 に向かって切る)

/**
 * テンプレートのブックに、当月の一行(と差し引きの一行)を書き込む。画面にもネットにも依らない。
 * @returns {{ rows: number, net: number, deduction: number }}
 */
export function fillInvoiceWorkbook(XLSX, wb, ctx) {
  const ws = wb.Sheets[DATA_SHEET];
  if (!ws) throw new Error(`シート「${DATA_SHEET}」が見つかりません`);
  const cell = (c, r) => XLSX.utils.encode_cell({ c, r: r - 1 });
  const put = (c, r, v) => { if (v === null || v === undefined || v === '') delete ws[cell(c, r)]; else ws[cell(c, r)] = { v, t: typeof v === 'number' ? 'n' : 's' }; };

  // 見本の会社情報は空けて、請求する人のことを置く(10-26:会社・住所・電話は設定の「あなたのこと」から)
  for (const a of ['F2', 'K2', 'K4']) delete ws[a];
  put(5, 2, ctx.address || null);                   // F2 住所(郵送にも)
  put(10, 2, ctx.clientCode || null);               // K2 取引先コード(元請けからもらった番号)
  put(10, 4, ctx.phone || null);                    // K4 電話番号
  put(5, 6, ctx.company || ctx.userName || null);   // F6 会社名(無ければ名前)
  put(10, 6, ctx.registration || null);             // K6 登録番号
  // 請求先(10-26):合計請求書の宛先(〒・住所・会社名 御中)。無ければテンプレートのまま
  const sum = wb.Sheets['合計請求書'];
  if (ctx.billing && sum) {
    const w = (a, v) => { if (v) sum[a] = { v, t: 's' }; else delete sum[a]; };
    w('B3', ctx.billing.postal); w('B4', ctx.billing.address); w('B5', ctx.billing.honorific);
  }
  put(5, 10, `${ctx.year}${String(ctx.month).padStart(2, '0')}`); // F10 請求年月(YYYYMM)
  ws['O11'] = { v: ctx.taxRate, t: 'n' };           // O11 消費税率

  // 見本の行は空ける(連番・式は残す)
  for (let r = FIRST_ROW; r <= LAST_ROW; r++) for (let c = COL.year; c <= COL.price; c++) delete ws[cell(c, r)];

  const line = (r, detail, price) => {
    put(COL.year, r, ctx.year); put(COL.month, r, ctx.month); put(COL.day, r, ctx.completionDay);
    put(COL.user, r, ctx.userName); put(COL.contact, r, ctx.billing?.person || ctx.contactName);
    put(COL.code, r, ctx.projectCode); put(COL.name, r, ctx.projectName);
    put(COL.detail, r, detail); put(COL.qty, r, 1); put(COL.unit, r, '式'); put(COL.price, r, price);
    // 式は残し、開いた直後にも正しい値が見えるように計算済みの値も置く
    const net = price, tax = trunc(net * ctx.taxRate);
    ws[cell(COL.net, r)]   = { t: 'n', v: net,       f: `IF(M${r}="","",K${r}*M${r})` };
    ws[cell(COL.tax, r)]   = { t: 'n', v: tax,       f: `IF(N${r}="","",ROUNDDOWN(N${r}*$O$11,0))` };
    ws[cell(COL.gross, r)] = { t: 'n', v: net + tax, f: `IF(N${r}="","",N${r}+O${r})` };
  };
  line(FIRST_ROW, '明細書1参照', ctx.amountExTax);
  let rows = 1;
  if (ctx.overtime?.amount > 0) {
    line(FIRST_ROW + rows, ctx.overtime.label, ctx.overtime.amount);
    rows += 1;
  }
  if (ctx.deduction > 0) {
    line(FIRST_ROW + rows, `立替の差し引き(内訳は別紙「${LEDGER_SHEET}」)`, -ctx.deduction);
    rows += 1;
  }

  // 別紙:立替内訳
  if (wb.Sheets[LEDGER_SHEET]) { delete wb.Sheets[LEDGER_SHEET]; wb.SheetNames = wb.SheetNames.filter(n => n !== LEDGER_SHEET); }
  if (ctx.ledger.length) {
    const aoa = [
      [`立替の内訳（${ctx.year}年${ctx.month}月分）`],
      [`現場：${ctx.projectName}`, '', `作成：${ctx.userName || ''}`],
      [],
      ['日付', '内容', '金額(円)', '立て替えた人', '一言'],
      ...ctx.ledger.map(r => [r.date, r.label, r.amount, r.payer, r.memo]),
      [],
      ['', '合計', ctx.deduction],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), LEDGER_SHEET);
  }

  const range = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 }, e: { r: 0, c: 0 } };
  range.e.r = Math.max(range.e.r, LAST_ROW - 1); range.e.c = Math.max(range.e.c, COL.gross);
  ws['!ref'] = XLSX.utils.encode_range(range);
  return { rows, net: ctx.amountExTax + (ctx.overtime?.amount || 0) - (ctx.deduction || 0), deduction: ctx.deduction || 0 };
}

/**
 * 指定現場・年月のデータをテンプレートExcelに書き込み、ダウンロードする。
 * @param {object} opts
 * @param {string}  opts.project_id
 * @param {number}  opts.year
 * @param {number}  opts.month  - 1-indexed
 */
export async function exportInvoiceToExcel({ project_id, year, month }) {
  load(); // Fail before loading an exporter when the source cannot be read.
  const XLSX = await import(XLSX_CDN);
  const data = load();
  const { contacts, projects } = data;

  const project = projects.find((p) => p.project_id === project_id);
  if (!project) throw new Error("現場が見つかりません");

  const work       = monthlySummary(project_id, year, month);
  const expSummary = monthlyExpenseSummary(project_id, year, month);

  // 完成納品日 = 当月の最終退勤日
  const lastCheckOutMs = work.sessions.length > 0
    ? Math.max(...work.sessions.map((s) => s.check_out_at))
    : null;
  const completionDay = lastCheckOutMs ? new Date(lastCheckOutMs).getDate() : null;

  const contact = contacts.find((c) => c.contact_id === project.site_contact_id);

  // ポンの立替(この現場・この月)。読めなければ書き出さずに止める
  const ym   = `${year}-${String(month).padStart(2, "0")}`;
  const pon  = ponRows(data, ym).filter(r => r.project_id === project_id);

  const unitPrice       = getUnitPrice();
  const subtotalExpense = expSummary.claim_status === ClaimStatus.SKIPPED ? 0 : expSummary.total;

  const res = await fetch(TEMPLATE_PATH);
  if (!res.ok) {
    throw new Error(
      `テンプレートの読み込みに失敗しました（${res.status}）。` +
      "\n/public/templates/Invoice_Gen_WithDetails.xlsx を配置してください。"
    );
  }
  const wb = XLSX.read(new Uint8Array(await res.arrayBuffer()), { type: "array", cellStyles: true });

  fillInvoiceWorkbook(XLSX, wb, {
    year, month, completionDay,
    userName: getSetting(SETTINGS_KEYS.USER_NAME) ?? "",
    company: getSetting(SETTINGS_KEYS.COMPANY) ?? "",
    address: getSetting(SETTINGS_KEYS.ADDRESS) ?? "",
    phone: getSetting(SETTINGS_KEYS.PHONE) ?? "",
    clientCode: getSetting(SETTINGS_KEYS.CLIENT_CODE) ?? "",
    billing: billingBlock(seikyusakiOf(project, data)),
    registration: getSetting(SETTINGS_KEYS.REGISTRATED_NUMBER) ?? "",
    contactName: contact?.name ?? "",
    projectCode: project.project_code ?? "",
    projectName: project.title ?? project.project_slug ?? "",
    amountExTax: work.total_days * unitPrice + subtotalExpense, // 日数で数える(同じ日は一日)
    overtime: work.overtime_minutes > 0 ? { label: `残業 ${formatMinutes(work.overtime_minutes)}(30分刻み)`, amount: overtimePay(work.overtime_minutes, unitPrice) } : null,
    taxRate: getTaxRate(),
    deduction: ponTotal(pon),
    ledger: ponLedgerRows(pon),
  });

  const filename = `${year}${String(month).padStart(2, "0")}_請求書.xlsx`;
  load(); // The template fetch may have outlived readable storage.
  const outBuf = XLSX.write(wb, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob   = new Blob([outBuf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
