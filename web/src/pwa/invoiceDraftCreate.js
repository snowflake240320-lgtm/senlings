// invoiceDraftCreate.js
// Hunterが「今月の請求書を作る」を押したときに invoiceDrafts を生成する

import { saveInvoiceDraft } from './firebase.js';

// ── localStorage から設定を読む ──────────────────────────

function getUnitPrice() {
  const v = localStorage.getItem('senlings_work_unit_price');
  return v ? Number(v) : 25000; // デフォルト25,000円/人工
}

function getTaxRate() {
  const v = localStorage.getItem('senlings_tax_rate');
  return v ? Number(v) : 0.10; // デフォルト10%
}

function getAllData() {
  const raw = localStorage.getItem('senlings_v0');
  return raw ? JSON.parse(raw) : {};
}

// ── 人工数の計算 ─────────────────────────────────────────

/**
 * work_sessions から指定月・プロジェクトの対象セッションを返す
 * 1セッション = 1人工（MVP）
 */
function calcWorkDays(sessions, billingMonth, projectId) {
  return sessions.filter(s => {
    const date = s.check_in_at
      ? new Date(s.check_in_at).toISOString().slice(0, 7) // YYYY-MM
      : null;
    return date === billingMonth && s.project_id === projectId;
  });
}

// ── 経費の集計 ───────────────────────────────────────────

/**
 * expenses から指定月・プロジェクトの対象経費を返す
 */
function calcExpenses(expenses, billingMonth, projectId) {
  return expenses.filter(e => {
    const month = e.expense_date ? e.expense_date.slice(0, 7) : null;
    return month === billingMonth && e.project_id === projectId;
  });
}

// ── 請求下書き生成 ───────────────────────────────────────

/**
 * 請求下書きを生成してFirestoreに保存する
 * @param {object} params
 * @param {string} params.projectId    - 対象プロジェクトID
 * @param {string} params.billingMonth - 請求月 YYYY-MM
 * @param {string} params.hunterUid    - Hunter の uid
 * @param {string|null} params.propertyId - 物件ID（任意）
 */
export async function createInvoiceDraft({
  projectId,
  billingMonth,
  hunterUid,
  propertyId = null,
}) {
  const data        = getAllData();
  const sessions    = data.work_sessions ?? [];
  const expenses    = data.expenses      ?? [];
  const unitPrice   = getUnitPrice();
  const taxRate     = getTaxRate();

  // 対象セッション・経費を絞り込む
  const targetSessions = calcWorkDays(sessions, billingMonth, projectId);
  const targetExpenses = calcExpenses(expenses, billingMonth, projectId);

  // 人工数・労務費
  const workDays     = targetSessions.length;
  const subtotalWork = workDays * unitPrice;

  // 経費合計
  const subtotalExpense = targetExpenses.reduce((sum, e) => sum + (e.amount ?? 0), 0);

  // 合計計算
  const subtotal  = subtotalWork + subtotalExpense;
  const taxAmount = Math.floor(subtotal * taxRate); // 切捨て
  const total     = subtotal + taxAmount;

  // workSessionIds（請求根拠）
  const workSessionIds = targetSessions.map(s => s.id).filter(Boolean);

  // expenseRefs（補助的参照）
  const expenseRefs = targetExpenses.map(e => ({
    sessionId: null, // ローカルにsessionIdなし
    expenseId: e.id,
  }));

  // invoiceId の生成
  const now       = new Date();
  const pad       = n => String(n).padStart(2, '0');
  const invoiceId = `inv_${billingMonth.replace('-', '')}_${hunterUid ?? 'unknown'}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;

  await saveInvoiceDraft({
    invoiceId,
    projectId,
    propertyId,
    hunterUid,
    billingMonth,
    workSessionIds,
    expenseRefs,
    status:         'draft',
    version:        1,
    taxRate,
    subtotalWork,
    subtotalExpense,
    subtotal,
    taxAmount,
    total,
  });

  return {
    invoiceId,
    workDays,
    subtotalWork,
    subtotalExpense,
    subtotal,
    taxAmount,
    total,
  };
}
