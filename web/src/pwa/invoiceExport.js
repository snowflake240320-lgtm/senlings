/**
 * invoiceExport.js — Excelエクスポート
 * 藤田建装指定テンプレートへの当月データ自動入力
 *
 * SheetJS は CDN ESM 版を動的 import（バンドラー不要、firebase.js と同方式）。
 * iOS PWA 対応: Blob + anchor click でダウンロード。
 */

import { load } from "./storage.js";
import { monthlySummary } from "./work.js";
import { monthlyExpenseSummary } from "./expenseQuery.js";
import { ClaimStatus } from "./expense.js";

const XLSX_CDN      = "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
const TEMPLATE_PATH = "/public/templates/Invoice_Gen_WithDetails.xlsx";
const DATA_SHEET    = "請求データ入力";
const DATA_ROW      = 18; // 1-indexed（テンプレート仕様）

function getUnitPrice() {
  const v = localStorage.getItem('senlings_work_unit_price');
  return v ? Number(v) : 25000;
}

/**
 * 指定現場・年月のデータをテンプレートExcelに書き込み、ダウンロードする。
 * @param {object} opts
 * @param {string}  opts.project_id
 * @param {number}  opts.year
 * @param {number}  opts.month  - 1-indexed
 */
export async function exportInvoiceToExcel({ project_id, year, month }) {
  const XLSX = await import(XLSX_CDN);
  const { contacts, projects } = load();

  const project = projects.find((p) => p.project_id === project_id);
  if (!project) throw new Error("現場が見つかりません");

  const work      = monthlySummary(project_id, year, month);
  const expSummary = monthlyExpenseSummary(project_id, year, month);

  // 完成納品日 = 当月の最終退勤日
  const lastCheckOutMs = work.sessions.length > 0
    ? Math.max(...work.sessions.map((s) => s.check_out_at))
    : null;
  const completionDay = lastCheckOutMs
    ? new Date(lastCheckOutMs).getDate()
    : null;

  // 藤田建装担当者名（ContactMaster）
  const contact     = contacts.find((c) => c.contact_id === project.site_contact_id);
  const contactName = contact?.name ?? "";

  // 御社ご担当者名（設定タブのお名前）
  const userName = localStorage.getItem("senlings_user_name") ?? "";

  // 金額計算（労務費 + 経費合計）
  const unitPrice      = getUnitPrice();
  const workDays       = work.sessions.length;
  const subtotalWork   = workDays * unitPrice;
  const subtotalExpense = expSummary.claim_status === ClaimStatus.SKIPPED ? 0 : expSummary.total;
  const amountExTax    = subtotalWork + subtotalExpense;
  const tax            = Math.floor(amountExTax * 0.1);
  const amountInTax    = amountExTax + tax;

  // テンプレート読み込み
  const res = await fetch(TEMPLATE_PATH);
  if (!res.ok) {
    throw new Error(
      `テンプレートの読み込みに失敗しました（${res.status}）。` +
      "\n/public/templates/Invoice_Gen_WithDetails.xlsx を配置してください。"
    );
  }
  const rawBuf = await res.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(rawBuf), { type: "array", cellStyles: true });

  const ws = wb.Sheets[DATA_SHEET];
  if (!ws) throw new Error(`シート「${DATA_SHEET}」が見つかりません`);

  // 請求年月 → C6 付近
  ws["C6"] = { v: `${year}年${String(month).padStart(2, "0")}月`, t: "s" };

  // データ行（18行目、SheetJS は 0-indexed なので r=17）
  const r    = DATA_ROW - 1;
  const addr = (col0) => XLSX.utils.encode_cell({ c: col0, r });

  ws[addr(1)]  = { v: year,                        t: "n" }; // B: 西暦年
  ws[addr(2)]  = { v: month,                       t: "n" }; // C: 月
  if (completionDay !== null) {
    ws[addr(3)] = { v: completionDay,               t: "n" }; // D: 日（完成納品日）
  }
  ws[addr(4)]  = { v: userName,                    t: "s" }; // E: 御社ご担当者名
  ws[addr(5)]  = { v: contactName,                 t: "s" }; // F: 藤田建装担当者
  ws[addr(6)]  = { v: project.project_code ?? "",  t: "s" }; // G: 工事コード
  ws[addr(7)]  = { v: project.title ?? project.project_slug ?? "", t: "s" }; // H: 工事名
  ws[addr(8)]  = { v: "明細書1参照",               t: "s" }; // I: 内容
  ws[addr(9)]  = { v: 1,                           t: "n" }; // J: 数量
  ws[addr(10)] = { v: "式",                        t: "s" }; // K: 単価単位
  // addr(11) = L: 単価 → 空欄のまま（単価は Senlings に持たない方針）
  ws[addr(12)] = { v: amountExTax,                 t: "n" }; // M: 金額税抜（労務費+経費）
  ws[addr(13)] = { v: tax,                         t: "n" }; // N: 消費税（10%・切捨）
  ws[addr(14)] = { v: amountInTax,                 t: "n" }; // O: 金額税込（M+N）

  // !ref を必要に応じて拡張（データ行が範囲外になる場合）
  if (ws["!ref"]) {
    const range = XLSX.utils.decode_range(ws["!ref"]);
    range.e.r = Math.max(range.e.r, r);
    range.e.c = Math.max(range.e.c, 14); // O列
    ws["!ref"] = XLSX.utils.encode_range(range);
  } else {
    ws["!ref"] = `A1:O${DATA_ROW}`;
  }

  // ダウンロード（iOS PWA 対応: Blob + anchor click）
  const ym       = `${year}${String(month).padStart(2, "0")}`;
  const filename = `${ym}_請求書.xlsx`;

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
