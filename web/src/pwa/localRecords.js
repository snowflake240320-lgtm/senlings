// Senlings 内で完結する私的記録。外部送信は行わない。
import { load, update } from './storage.js';

export const SOS_LABELS = {
  access_delivery: '入れない・搬入できない', drawing_diff: '図面と違う',
  fit_unknown: '納まりがわからない', contact_unknown: '誰に聞けばいいかわからない', danger: '危ない',
};

export function saveLocalRecord(record) {
  if (!record.id || !record.project_id || !['memo', 'sos'].includes(record.kind) ||
      typeof record.text !== 'string' || record.text.length > 10000 ||
      (record.kind === 'memo' && !record.text.trim()) ||
      (record.kind === 'sos' && !Object.hasOwn(SOS_LABELS, record.field_key)) || !Number.isFinite(record.created_at)) {
    throw new Error('現場と記録の内容を確認してください。');
  }
  let saved;
  update(data => {
    if (!data.projects.some(p => p.project_id === record.project_id)) throw new Error('現場が見つかりません。');
    data.local_records ??= [];
    saved = data.local_records.find(r => r.id === record.id);
    if (saved) {
      if (saved.project_id !== record.project_id || saved.kind !== record.kind) throw new Error('記録IDが一致しません。画面を開き直してください。');
      return data;
    }
    saved = { id: record.id, project_id: record.project_id, kind: record.kind,
      text: record.text, field_key: record.kind === 'sos' ? record.field_key : null,
      created_at: record.created_at, visibility: 'private', delivery_status: 'not_sent' };
    data.local_records.push(saved);
    return data;
  });
  return saved;
}

export function listLocalRecords(projectId) {
  return (load().local_records ?? []).filter(r => !projectId || r.project_id === projectId);
}

export function contactPhone(project) {
  const value = project.site_info?.contact_phone;
  if (typeof value !== 'string') return null;
  const phone = value.replace(/[\s()-]/g, '');
  return /^\+?\d{6,15}$/.test(phone) ? phone : null;
}

// つないだ控え(10-26 船長「つなぐを考えたとき、請求書でなく、自分のための備忘録もほしい」)。
// ほかの人へつないだとき、自分だけの控え。請求にも CSV にも入れない。相手には何も送らない。数えない。
export function saveTsunagi({ id, site_name, work_date = '', to = '', text = '', created_at = Date.now() }) {
  if (typeof id !== 'string' || !id || typeof site_name !== 'string' || !site_name.trim() || typeof to !== 'string' || to.length > 200 ||
      typeof text !== 'string' || text.length > 20000 || typeof work_date !== 'string' || !Number.isFinite(created_at)) {
    throw new Error('控えの内容を確認してください。');
  }
  let saved;
  update(data => {
    data.tsunagi ??= [];
    saved = data.tsunagi.find(r => r.id === id);
    if (saved) return data;
    saved = { id, site_name: site_name.trim().slice(0, 200), work_date, to: to.trim(), text, created_at };
    data.tsunagi.push(saved);
    return data;
  });
  return saved;
}
export function listTsunagi() { return load().tsunagi ?? []; }
