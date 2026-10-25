import { load } from './storage.js';
// csvExport.js
// localStorageのデータをCSV形式でエクスポートする

import { getSetting, SETTINGS_KEYS } from './settings.js';
import { ponRows, ponLedgerRows } from './nakama.js';
import { sessionDate, isTeiji, overtimePay, formatMinutes } from './work.js';

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
  return load();
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
  // すぐに消すと、端末によっては名前のない「download」になったり、書き出しが途中で切れたりする
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
 * work_sessions を労務費CSV行に変換する（1日・1現場 = 1人工）。
 * 同じ日・同じ現場に記録が二つあっても一人工。日付は端末の暦。
 * 残業(「残業おつかれさま」を押した分)は、別の行で足す。
 */
function sessionsToRows(sessions, projects) {
  const unitPrice = getUnitPrice();
  const taxRate   = getTaxRate();
  const seen = new Set();
  const rows = [];
  for (const s of [...sessions].sort((a, b) => a.check_in_at - b.check_in_at)) {
    const date    = sessionDate(s);
    const project = projects.find(p => p.project_id === s.project_id);
    const place   = project?.address ?? project?.project_slug ?? '';
    const code    = project?.project_code ?? '';
    const key = `${date}|${s.project_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      rows.push([date, '完成工事高', unitPrice, Math.floor(unitPrice * taxRate), '労務費（1人工）', place, code]);
    }
    if (isTeiji(s) && s.overtime_minutes > 0) {
      const pay = overtimePay(s.overtime_minutes, unitPrice);
      rows.push([date, '完成工事高', pay, Math.floor(pay * taxRate), `残業 ${formatMinutes(s.overtime_minutes)}`, place, code]);
    }
  }
  return rows;
}

/**
 * ポンの立替(元請けが立て替え、請求から差し引いた分)を経費の行にする。
 * 勘定科目と消費税の扱いは税理士さんの答え待ちなので、科目は「確認中」、消費税は空けておく。
 */
function ponToRows(data, billingMonth, projects) {
  return ponLedgerRows(ponRows(data, billingMonth)).map(r => {
    const project = projects.find(p => p.project_id === r.project_id);
    return [
      r.date,
      '立替(勘定科目は確認中)',
      r.amount,
      '',
      `立替の差し引き ${r.label}${r.payer ? `(${r.payer})` : ''}${r.memo ? ` ${r.memo}` : ''}`,
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
  const sessions = (data.work_sessions ?? []).filter(s => sessionDate(s).slice(0, 7) === billingMonth);
  const expenses = (data.expenses ?? []).filter(e =>
    (e.expense_date ?? '').slice(0, 7) === billingMonth
  );

  const rows = [
    ...sessionsToRows(sessions, projects),
    ...expensesToRows(expenses, projects),
    ...ponToRows(data, billingMonth, projects),
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
