/**
 * storage.js — localStorage の唯一の窓口
 * キー: "senlings_v0" 固定
 */

const STORAGE_KEY = "senlings_v0";

const DEFAULT_STATE = {
  projects: [],
  contacts: [],
  work_sessions: [],
  expenses: [],
  invoice_snapshots: [],
  photos: [],
  event_log: [],
};

export class StorageReadError extends Error {
  constructor() {
    super("保存データを読み取れません。書込みを止めました。再読取してください。");
    this.name = "StorageReadError";
  }
}

export class StorageWriteError extends Error {
  constructor() {
    super("保存に失敗しました。この操作は完了していません。");
    this.name = "StorageWriteError";
  }
}

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = value => typeof value === "number" && Number.isFinite(value) && !Number.isNaN(new Date(value).getTime());

// Missing collections are supported for older saves. Never repair present invalid values.
function safeShape(data) {
  if (!record(data)) return false;
  for (const key of [...Object.keys(DEFAULT_STATE), 'local_records', 'handoff_receipts', 'tsunagi', 'seikyusaki']) {
    if (Object.hasOwn(data, key) && (!Array.isArray(data[key]) || !data[key].every(record))) return false;
  }
  for (const r of data.local_records ?? []) {
    if (typeof r.id !== 'string' || typeof r.project_id !== 'string' || !['memo', 'sos'].includes(r.kind) || typeof r.text !== 'string' || !timestamp(r.created_at)) return false;
  }
  for (const r of data.seikyusaki ?? []) {
    if (typeof r.id !== 'string' || typeof r.company !== 'string' || ['address', 'person', 'phone', 'email', 'line'].some(k => r[k] != null && typeof r[k] !== 'string')) return false;
  }
  for (const r of data.tsunagi ?? []) {
    if (typeof r.id !== 'string' || typeof r.site_name !== 'string' || typeof r.to !== 'string' || typeof r.text !== 'string' || !timestamp(r.created_at)) return false;
  }
  for (const r of data.handoff_receipts ?? []) {
    if (typeof r.project_id !== 'string' || !timestamp(r.received_at) || typeof r.raw !== 'string' || !record(r.packet) ||
        typeof r.packet.source_project_id !== 'string' || !Number.isSafeInteger(r.packet.revision) || !record(r.packet.project)) return false;
  }
  if (data.settings != null && (!record(data.settings) || Object.values(data.settings).some(v => v !== null && typeof v !== 'string'))) return false;
  const stringFields = {
    projects: ['project_id', 'project_slug', 'address', 'project_code', 'site_contact_id', 'start_date', 'seikyusaki_id'],
    contacts: ['contact_id', 'name', 'role', 'phone', 'company'],
    work_sessions: ['id', 'project_id'],
    expenses: ['id', 'project_id', 'expense_date', 'category', 'memo'],
    photos: ['id', 'project_id', 'filename', 'atmosphere', 'thumbnail'],
    invoice_snapshots: ['snapshot_id', 'project_id', 'project_code', 'period_start', 'period_end'],
  };
  for (const [key, fields] of Object.entries(stringFields)) {
    for (const item of data[key] ?? []) {
      if (fields.some(field => item[field] != null && typeof item[field] !== "string")) return false;
    }
  }
  for (const [key, field] of [['projects', 'archive'], ['contacts', 'active'], ['photos', 'deleted']]) {
    if ((data[key] ?? []).some(item => item[field] != null && typeof item[field] !== "boolean")) return false;
  }
  for (const p of data.projects ?? []) {
    if (typeof p.project_id !== "string" || typeof p.project_slug !== "string") return false;
    if (p.site_info != null && !record(p.site_info)) return false;
  }
  for (const s of data.work_sessions ?? []) {
    if (typeof s.project_id !== "string" || !timestamp(s.check_in_at) ||
        !timestamp(s.check_out_at) || typeof s.break_minutes !== "number" || !Number.isFinite(s.break_minutes)) return false;
  }
  for (const s of data.work_sessions ?? []) {
    if (['travel_start_at', 'travel_end_at'].some(field => s[field] != null && !timestamp(s[field]))) return false;
  }
  // 定時の一日(kind: 'teiji')。kind は無いか 'teiji' だけ。一日は一つ。
  const teijiDates = new Set();
  for (const s of data.work_sessions ?? []) {
    if (s.kind == null) continue;
    if (s.kind !== 'teiji' || typeof s.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || teijiDates.has(s.date) ||
        !Number.isSafeInteger(s.overtime_minutes ?? 0) || (s.overtime_minutes ?? 0) < 0 || (s.overtime_minutes ?? 0) > 720) return false;
    teijiDates.add(s.date);
  }
  for (const p of data.projects ?? []) {
    if (p.teiji != null && (!record(p.teiji) || ['start', 'end'].some(k => typeof p.teiji[k] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.teiji[k])))) return false;
  }
  for (const e of data.expenses ?? []) {
    if (typeof e.project_id !== "string" || typeof e.expense_date !== "string" ||
        typeof e.amount !== "number" || !Number.isFinite(e.amount)) return false;
  }
  if (data.current_session != null && (!record(data.current_session) ||
      typeof data.current_session.project_id !== "string" || !timestamp(data.current_session.check_in_at))) return false;
  return true;
}

export function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { status: "absent", raw, data: structuredClone(DEFAULT_STATE) };
    const parsed = JSON.parse(raw);
    if (!safeShape(parsed)) throw new StorageReadError();
    return { status: "valid", raw, data: { ...structuredClone(DEFAULT_STATE), ...parsed } };
  } catch {
    return { status: "unreadable", error: new StorageReadError() };
  }
}

function fail(error) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("senlings-storage-error", { detail: error }));
  throw error;
}

export function readOrThrow() {
  const result = read();
  if (result.status === "unreadable") fail(result.error);
  return result;
}

export function load() {
  return readOrThrow().data;
}

export function save(data) {
  // Re-read immediately before every write, even after a successful startup/load.
  load();
  if (!safeShape(data)) fail(new StorageWriteError());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    fail(new StorageWriteError());
  }
}

export function update(fn) {
  const data = load();
  const next = fn(data);
  save(next);
  return next;
}

export function clear() {
  load();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    fail(new StorageWriteError());
  }
}
