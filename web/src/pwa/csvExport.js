// csvExport.js
// localStorageのデータをCSV形式でエクスポートする

import { getSetting, SETTINGS_KEYS } from './settings.js';

// 勘定科目マッピング
const ACCOUNT_MAP = {
  parking:       '旅費交通費',
  highway:       '旅費交通費',
  fuel:          '車両費',
  train:         '旅費交通費',
  shinkansen:    '旅費交通費',
  flight:        '旅費交通費',
  hotel:         '旅費交通費',
  material:      '材料費',
  tool_rental:   '賃借料',
  tool_purchase: '消耗品費',
  shipping:      '荷造運賃',
  communication: '通信費',
  other:         '雑費',
};

// カテゴリ正規化（STEP 8で確定）
const CATEGORY_NORMALIZE = {
  toll:           'highway',
  material_small: 'material',
};

function normalizeCategory(cat) {
  return CATEGORY_NORMALIZE[cat] ?? cat;
}

function getAllData() {
  const raw = localStorage.getItem('senlings_v0');
  return raw ? JSON.parse(raw) : {};
}

function getTaxRate() {
  const v = getSetting(SETTINGS_KEYS.TAX_RATE);
  return v ? Number(v) : 0.10;
}

function getUnitPrice() {
  const v = getSetting(SETTINGS_KEYS.WORK_UNIT_PRICE);
  return v ? Number(v) : 25000;
}

/**
 * CSV文字列を生成してダウンロードする
 */
function downloadCSV(rows, filename) {
  const header = ['日付', '勘定科目', '金額（税抜）', '消費税', '摘要', '現場名', '工事コード'];
  const lines = [header, ...rows].map(row =>
    row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')
  );
  const bom  = '﻿'; // Excel文字化け防止
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * expenses を CSV行に変換する
 */
function expensesToRows(expenses, projects) {
  const taxRate = getTaxRate();
  return expenses.map(e => {
    const cat     = normalizeCategory(e.category ?? 'other');
    const account = ACCOUNT_MAP[cat] ?? '雑費';
    const amount  = e.amount ?? 0;
    const tax     = Math.floor(amount * taxRate);
    const project = projects.find(p => p.project_id === e.project_id);
    return [
      e.expense_date ?? '',
      account,
      amount,
      tax,
      e.memo ?? cat,
      project?.address ?? project?.project_slug ?? '',
      project?.project_code ?? '',
    ];
  });
}

/**
 * work_sessions を労務費CSV行に変換する（1セッション = 1人工）
 */
function sessionsToRows(sessions, projects) {
  const unitPrice = getUnitPrice();
  const taxRate   = getTaxRate();
  return sessions.map(s => {
    const date    = s.check_in_at
      ? new Date(s.check_in_at).toISOString().slice(0, 10)
      : '';
    const tax     = Math.floor(unitPrice * taxRate);
    const project = projects.find(p => p.project_id === s.project_id);
    return [
      date,
      '完成工事高',
      unitPrice,
      tax,
      '労務費（1人工）',
      project?.address ?? project?.project_slug ?? '',
      project?.project_code ?? '',
    ];
  });
}

/**
 * 月次CSVエクスポート（YYYY-MM）
 */
export function exportMonthlyCSV(billingMonth) {
  const data     = getAllData();
  const projects = data.projects       ?? [];
  const sessions = (data.work_sessions ?? []).filter(s => {
    const month = s.check_in_at
      ? new Date(s.check_in_at).toISOString().slice(0, 7)
      : null;
    return month === billingMonth;
  });
  const expenses = (data.expenses ?? []).filter(e =>
    (e.expense_date ?? '').slice(0, 7) === billingMonth
  );

  const rows = [
    ...sessionsToRows(sessions, projects),
    ...expensesToRows(expenses, projects),
  ];

  const filename = `senlings_${billingMonth}_monthly.csv`;
  downloadCSV(rows, filename);
  return { rows: rows.length };
}

/**
 * 工事単位CSVエクスポート（project_id）
 */
export function exportProjectCSV(projectId) {
  const data     = getAllData();
  const projects = data.projects       ?? [];
  const sessions = (data.work_sessions ?? []).filter(s => s.project_id === projectId);
  const expenses = (data.expenses      ?? []).filter(e => e.project_id === projectId);

  const rows = [
    ...sessionsToRows(sessions, projects),
    ...expensesToRows(expenses, projects),
  ];

  const project  = projects.find(p => p.project_id === projectId);
  const label    = project?.project_slug ?? projectId;
  const filename = `senlings_${label}_project.csv`;
  downloadCSV(rows, filename);
  return { rows: rows.length };
}
