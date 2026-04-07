/**
 * expenseQuery.js — 経費の読み取り（クエリ）
 * 書き込みは expense.js に分離
 */

import { load } from "./storage.js";
import { ClaimStatus } from "./expense.js";

/**
 * 指定プロジェクト・年月の経費合計と claimable 状態を返す。
 * @param {string} projectId
 * @param {number} year
 * @param {number} month - 1-indexed
 * @returns {{ total: number, claim_status: string, expenses: object[] }}
 */
export function monthlyExpenseSummary(projectId, year, month) {
  const { expenses, event_log } = load();

  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const items = expenses.filter(
    (e) => e.project_id === projectId && e.expense_date.startsWith(ym)
  );

  const total = items.reduce((sum, e) => sum + e.amount, 0);

  // event_log に skipped/confirmed の明示的な上書きがあれば優先する
  const overrideEntry = [...event_log]
    .reverse()
    .find(
      (log) =>
        log.type === "expense_claim_status_set" &&
        log.project_id === projectId &&
        log.period === ym
    );

  let claim_status;
  if (overrideEntry) {
    claim_status = overrideEntry.status;
  } else if (items.length === 0) {
    claim_status = ClaimStatus.UNCONFIRMED;
  } else {
    claim_status = ClaimStatus.CONFIRMED;
  }

  return { total, claim_status, expenses: items };
}
