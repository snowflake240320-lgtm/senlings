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

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(raw) };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export function save(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function update(fn) {
  const data = load();
  const next = fn(data);
  save(next);
  return next;
}

export function clear() {
  localStorage.removeItem(STORAGE_KEY);
}
