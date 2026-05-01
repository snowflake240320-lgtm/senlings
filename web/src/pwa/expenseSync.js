// expenseSync.js
// localStorageのexpensesをFirestoreのworkSessions/{sessionId}/expensesへ同期する

import { saveExpense } from './firebase.js';

function getLocalExpenses() {
  const raw = localStorage.getItem('senlings_v0');
  if (!raw) return [];
  const data = JSON.parse(raw);
  return data.expenses ?? [];
}

/**
 * localStorageのexpenseをFirestoreのexpensesスキーマへ変換する
 *
 * expense.js の実際のフィールド:
 *   id, project_id, expense_date (YYYY-MM-DD), category, amount, memo?, created_at (ms)
 *   ※ session_id フィールドは存在しない（project_id のみで紐付く）
 */
function toFirestoreExpense(local) {
  return {
    expenseId:  local.id            ?? null,
    projectId:  local.project_id    ?? null,
    propertyId: null,
    hunterUid:  null,
    date:       local.expense_date  ?? null,
    category:   mapCategory(local.category ?? 'other'),
    amount:     local.amount        ?? 0,
    status:     'draft',
    memo:       local.memo          ?? null,
    photoIds:   [],
  };
}

/**
 * カテゴリ値をFirestoreのenum値へマッピングする
 * expense.js の実際のカテゴリ: parking / toll / fuel / material_small / tool_rental / other
 */
function mapCategory(localCategory) {
  const map = {
    'parking':        'parking',
    'toll':           'highway',
    'fuel':           'fuel',
    'material_small': 'material',
    'tool_rental':    'tool_rental',
    'other':          'other',
  };
  return map[localCategory] ?? 'other';
}

/**
 * すべての expenses を Firestore へ同期する
 * sessionId が不明な場合はスキップしてエラーログに記録する
 *
 * ※ 現在のローカルスキーマには session_id が存在しないため、
 *    既存の全経費はスキップされる。将来 session_id が追加された時点で同期可能になる。
 */
export async function syncExpensesToFirestore() {
  const expenses = getLocalExpenses();
  if (expenses.length === 0) return { synced: 0, errors: [] };

  let synced = 0;
  const errors = [];

  for (const expense of expenses) {
    const sessionId = expense.session_id ?? expense.work_session_id ?? null;
    if (!sessionId) {
      errors.push({ expense, err: 'sessionId が見つかりません' });
      continue;
    }
    try {
      const fsData = toFirestoreExpense(expense);
      await saveExpense(sessionId, fsData);
      synced++;
    } catch (err) {
      errors.push({ expense, err: err.message });
    }
  }

  return { synced, errors };
}
