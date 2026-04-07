/**
 * expense.js — 経費の書き込み（ミューテーション）+ 定数
 * EXPENSE_SPEC_v0 に基づく
 *
 * カテゴリ: parking / toll / fuel / material_small / tool_rental / other
 * claimable 状態: confirmed / skipped / unconfirmed
 *
 * 読み取り（クエリ）は expenseQuery.js に分離
 */

import { load, update } from "./storage.js";

export const ExpenseCategory = Object.freeze({
  PARKING:       "parking",
  TOLL:          "toll",
  FUEL:          "fuel",
  MATERIAL_SMALL: "material_small",
  TOOL_RENTAL:   "tool_rental",
  OTHER:         "other",
});

/** 請求可否の確定状態 */
export const ClaimStatus = Object.freeze({
  CONFIRMED:   "confirmed",   // 入力済・確定
  SKIPPED:     "skipped",     // 今月は請求しない（0円で確定）
  UNCONFIRMED: "unconfirmed", // 未入力の可能性あり → 警告
});

/**
 * 経費を保存する。
 * @param {object} expense
 * @param {string} expense.id
 * @param {string} expense.project_id
 * @param {string} expense.expense_date - YYYY-MM-DD
 * @param {string} expense.category     - ExpenseCategory
 * @param {number} expense.amount
 * @param {string} [expense.memo]
 * @param {number} expense.created_at   - timestamp (ms)
 */
export function saveExpense(expense) {
  update((data) => {
    data.expenses.push(expense);
    data.event_log.push({
      type:       "expense_created",
      expense_id: expense.id,
      at:         expense.created_at,
    });
    return data;
  });
}

/**
 * 経費を更新する（修正履歴を event_log に記録）。
 * @param {string} id
 * @param {object} patch - 変更フィールド
 */
export function updateExpense(id, patch) {
  const now = Date.now();
  update((data) => {
    const idx = data.expenses.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Expense not found: ${id}`);

    const before = { ...data.expenses[idx] };
    data.expenses[idx] = { ...before, ...patch, updated_at: now };

    data.event_log.push({
      type:       "expense_updated",
      expense_id: id,
      before,
      after:      data.expenses[idx],
      at:         now,
    });
    return data;
  });
}

/**
 * 経費を削除する（event_log に記録）。
 * @param {string} id
 */
export function deleteExpense(id) {
  const now = Date.now();
  update((data) => {
    const idx = data.expenses.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Expense not found: ${id}`);

    const deleted = data.expenses.splice(idx, 1)[0];
    data.event_log.push({
      type:       "expense_deleted",
      expense_id: id,
      snapshot:   deleted,
      at:         now,
    });
    return data;
  });
}

/**
 * 請求対象月の経費状態を手動で上書きする（skipped / confirmed）。
 * Invoice生成前に呼ぶ想定。
 * @param {string} projectId
 * @param {number} year
 * @param {number} month
 * @param {string} status - ClaimStatus
 */
export function setClaimStatus(projectId, year, month, status) {
  const now = Date.now();
  update((data) => {
    data.event_log.push({
      type:       "expense_claim_status_set",
      project_id: projectId,
      period:     `${year}-${String(month).padStart(2, "0")}`,
      status,
      at:         now,
    });
    return data;
  });
}
