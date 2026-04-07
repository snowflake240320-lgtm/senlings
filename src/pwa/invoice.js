/**
 * invoice.js — Invoice Snapshot 生成
 * INVOICE_SNAPSHOT_DETAIL_SPEC / STATE_MACHINE_v0 に基づく
 *
 * - 生成後は不変（元データが変わっても Snapshot は変化しない）
 * - source_hash で改ざん防止
 * - daily_breakdown を凍結保存
 */

import { update } from "./storage.js";
import { monthlySummary, buildDailyBreakdown } from "./work.js";
import { ClaimStatus } from "./expense.js";
import { monthlyExpenseSummary } from "./expenseQuery.js";

/**
 * セッション配列から決定的ハッシュ文字列を生成する（簡易実装）。
 * @param {object[]} sessions
 * @returns {string}
 */
function buildSourceHash(sessions) {
  const payload = sessions
    .map((s) => `${s.id}:${s.check_in_at}:${s.check_out_at}:${s.break_minutes}`)
    .sort()
    .join("|");

  // FNV-1a 32bit（依存ゼロの簡易ハッシュ）
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Invoice Snapshot を生成して保存する。
 *
 * @param {object} opts
 * @param {string}  opts.snapshot_id
 * @param {string}  opts.project_id
 * @param {string}  opts.project_code  - 生成時点のコード（スナップショット値）
 * @param {number}  opts.year
 * @param {number}  opts.month         - 1-indexed
 * @returns {object} 生成された Snapshot
 * @throws {Error}   経費状態が UNCONFIRMED の場合（STATE_MACHINE Warning フロー）
 */
export function generateSnapshot({ snapshot_id, project_id, project_code, year, month }) {
  const work = monthlySummary(project_id, year, month);
  const expSummary = monthlyExpenseSummary(project_id, year, month);

  if (expSummary.claim_status === ClaimStatus.UNCONFIRMED) {
    throw new UnconfirmedExpenseError(
      `経費が未確定です。確定（confirmed）またはスキップ（skipped）してから生成してください。` +
      ` project_id=${project_id} period=${year}-${String(month).padStart(2, "0")}`
    );
  }

  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const daily_breakdown = buildDailyBreakdown(work.sessions);
  const source_hash = buildSourceHash(work.sessions);

  const snapshot = {
    snapshot_id,
    project_id,
    project_code:          project_code ?? null,
    period_start:          periodStart,
    period_end:            periodEnd,
    total_work_days:       work.total_days,
    total_work_minutes:    work.total_work_minutes,
    total_overtime_hours:  work.total_overtime_hours,
    total_expense_amount:  expSummary.claim_status === ClaimStatus.SKIPPED ? 0 : expSummary.total,
    expense_claim_status:  expSummary.claim_status,
    daily_breakdown,
    source_hash,
    generated_at:          Date.now(),
  };

  update((data) => {
    data.invoice_snapshots.push(snapshot);
    data.event_log.push({
      type:        "invoice_snapshot_generated",
      snapshot_id,
      project_id,
      period:      `${year}-${String(month).padStart(2, "0")}`,
      source_hash,
      at:          snapshot.generated_at,
    });
    return data;
  });

  return snapshot;
}

/**
 * 経費未確定のまま Snapshot 生成しようとしたときのエラー。
 * 呼び出し元で catch して Warning モードに遷移させる。
 */
export class UnconfirmedExpenseError extends Error {
  constructor(message) {
    super(message);
    this.name = "UnconfirmedExpenseError";
  }
}
