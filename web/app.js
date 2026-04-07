/**
 * app.js — Senlings v0.2.0
 * src/pwa/ モジュールとUIを接続する
 */

import { saveSession, monthlySummary } from "../src/pwa/work.js";
import { transition, getMode, Mode } from "../src/pwa/state.js";
import { generateSnapshot, UnconfirmedExpenseError } from "../src/pwa/invoice.js";
import { setClaimStatus, ClaimStatus } from "../src/pwa/expense.js";

// --- デモ用固定値 ---
const PROJECT_ID   = "20250201_SHIBUYA";
const PROJECT_CODE = null;

const now = new Date();
const YEAR  = now.getFullYear();
const MONTH = now.getMonth() + 1;

// --- 内部状態 ---
let checkInAt = null;

// --- DOM ---
const statusDisplay  = document.getElementById("status-display");
const btnCheckin     = document.getElementById("btn-checkin");
const btnCheckout    = document.getElementById("btn-checkout");
const btnSummary     = document.getElementById("btn-summary");
const summaryDisplay = document.getElementById("summary-display");
const btnInvoice     = document.getElementById("btn-invoice");
const btnSkip        = document.getElementById("btn-skip-expense");
const invoiceDisplay = document.getElementById("invoice-display");

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function updateStatus() {
  statusDisplay.textContent = `状態: ${getMode()}`;
}

// ----------------------------------------------------------------
// 出勤ボタン → work.js の saveSession() への接続起点
// check_in_at を記録し、退勤時に saveSession() で保存する
// ----------------------------------------------------------------
btnCheckin.addEventListener("click", () => {
  // IDLE → MOVING → ON_SITE → WORKING（v0 では即時遷移）
  transition(Mode.MOVING,  PROJECT_ID);
  transition(Mode.ON_SITE, PROJECT_ID);
  transition(Mode.WORKING, PROJECT_ID);

  checkInAt = Date.now();
  btnCheckin.disabled  = true;
  btnCheckout.disabled = false;
  updateStatus();
  console.log("出勤:", new Date(checkInAt).toLocaleTimeString());
});

// ----------------------------------------------------------------
// 退勤ボタン → state.js の transition() + work.js の saveSession()
// ----------------------------------------------------------------
btnCheckout.addEventListener("click", () => {
  const checkOutAt = Date.now();

  const session = {
    id:             uid(),
    project_id:     PROJECT_ID,
    check_in_at:    checkInAt,
    check_out_at:   checkOutAt,
    break_minutes:  0,
  };

  // work.js: セッション保存
  saveSession(session);

  // state.js: WORKING → ON_SITE → MOVING → IDLE
  transition(Mode.ON_SITE);
  transition(Mode.MOVING);
  transition(Mode.IDLE);

  checkInAt = null;
  btnCheckin.disabled  = false;
  btnCheckout.disabled = true;
  updateStatus();
  console.log("退勤:", new Date(checkOutAt).toLocaleTimeString());
});

// ----------------------------------------------------------------
// 月次サマリー表示 → work.js の monthlySummary()
// ----------------------------------------------------------------
btnSummary.addEventListener("click", () => {
  const result = monthlySummary(PROJECT_ID, YEAR, MONTH);

  const hours   = Math.floor(result.total_work_minutes / 60);
  const minutes = result.total_work_minutes % 60;
  const overtime = result.total_overtime_hours.toFixed(2);

  summaryDisplay.textContent = [
    `期間: ${YEAR}/${String(MONTH).padStart(2, "0")}`,
    `勤務日数: ${result.total_days} 日`,
    `勤務時間: ${hours}時間${minutes}分`,
    `超過時間: ${overtime}時間`,
    `セッション数: ${result.sessions.length} 件`,
  ].join("\n");
});

// ----------------------------------------------------------------
// 請求下書きボタン → invoice.js の generateSnapshot()
// ----------------------------------------------------------------
btnInvoice.addEventListener("click", () => {
  invoiceDisplay.textContent = "";
  invoiceDisplay.className   = "";
  btnSkip.style.display      = "none";

  transition(Mode.INVOICE_REVIEW);

  try {
    transition(Mode.SNAPSHOT_READY);

    const snapshot = generateSnapshot({
      snapshot_id:  uid(),
      project_id:   PROJECT_ID,
      project_code: PROJECT_CODE,
      year:         YEAR,
      month:        MONTH,
    });

    transition(Mode.CONFIRMED);
    transition(Mode.IDLE);
    updateStatus();

    invoiceDisplay.textContent = formatSnapshot(snapshot);
  } catch (err) {
    if (err instanceof UnconfirmedExpenseError) {
      // STATE_MACHINE: SNAPSHOT_READY → WARNING
      transition(Mode.WARNING);
      updateStatus();

      invoiceDisplay.className   = "warn";
      invoiceDisplay.textContent = "⚠ 経費が未確定です。\n" + err.message;
      btnSkip.style.display      = "inline-block";
    } else {
      transition(Mode.IDLE);
      updateStatus();
      invoiceDisplay.textContent = `エラー: ${err.message}`;
      console.error(err);
    }
  }
});

// ----------------------------------------------------------------
// 経費スキップボタン → expense.js の setClaimStatus() → 再生成
// ----------------------------------------------------------------
btnSkip.addEventListener("click", () => {
  setClaimStatus(PROJECT_ID, YEAR, MONTH, ClaimStatus.SKIPPED);
  btnSkip.style.display = "none";

  // WARNING → CONFIRMED フロー
  const snapshot = generateSnapshot({
    snapshot_id:  uid(),
    project_id:   PROJECT_ID,
    project_code: PROJECT_CODE,
    year:         YEAR,
    month:        MONTH,
  });

  transition(Mode.CONFIRMED);
  transition(Mode.IDLE);
  updateStatus();

  invoiceDisplay.className   = "";
  invoiceDisplay.textContent = formatSnapshot(snapshot);
});

function formatSnapshot(s) {
  const hours   = Math.floor(s.total_work_minutes / 60);
  const minutes = s.total_work_minutes % 60;

  const lines = [
    `[Invoice Snapshot]`,
    `snapshot_id:   ${s.snapshot_id}`,
    `period:        ${s.period_start} 〜 ${s.period_end}`,
    `勤務日数:      ${s.total_work_days} 日`,
    `勤務時間:      ${hours}時間${minutes}分`,
    `超過時間:      ${s.total_overtime_hours.toFixed(2)}時間`,
    `経費合計:      ¥${s.total_expense_amount.toLocaleString()}`,
    `経費状態:      ${s.expense_claim_status}`,
    `source_hash:   ${s.source_hash}`,
    `generated_at:  ${new Date(s.generated_at).toLocaleString()}`,
    ``,
    `[日別内訳]`,
    ...s.daily_breakdown.map(
      (d) => `  ${d.date}  ${d.work_minutes}分  ${d.session_count}件`
    ),
  ];

  return lines.join("\n");
}

updateStatus();
console.log("Senlings v0.2.0 loaded");
