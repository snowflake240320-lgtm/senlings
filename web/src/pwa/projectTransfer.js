// 手渡し用の明示的な形式。私的な記録・勤怠・請求はこの形式に含めない。
import { load, save } from './storage.js';

export const TRANSFER_FIELDS = [
  ['address', '住所'], ['entrance', '現場アクセス'], ['equipment', '装備・入場条件'],
  ['parking', '駐車場'], ['toilet', 'トイレ'], ['morning_assembly', '朝礼'],
  ['delivery', '搬入'], ['contact', '連絡先・担当者'], ['contact_phone', '電話番号'],
  ['raw', '届いた連絡の原文'],
];
const format = 'senlings.project-handoff';
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export function parseTransfer(raw) {
  if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 128000) throw new Error('物件情報は128KB以内のJSONを選んでください。');
  let packet;
  try { packet = JSON.parse(raw); } catch { throw new Error('物件情報のJSONを読み取れません。連絡文は「現場を追加する」に貼り付けられます。'); }
  if (!object(packet) || packet.format !== format || packet.schema_version !== 1 ||
      typeof packet.source_project_id !== 'string' || !packet.source_project_id || packet.source_project_id.length > 200 ||
      !Number.isSafeInteger(packet.revision) || packet.revision < 1 || !object(packet.project) ||
      typeof packet.project.name !== 'string' || !packet.project.name.trim() || packet.project.name.length > 200) {
    throw new Error('対応する物件情報ではありません。形式・物件ID・版・現場名を確認してください。');
  }
  const project = { name: packet.project.name };
  if (Object.keys(packet).some(key => !['format', 'schema_version', 'source_project_id', 'revision', 'project'].includes(key)) ||
      Object.keys(packet.project).some(key => !['name', ...TRANSFER_FIELDS.map(([key]) => key)].includes(key))) {
    throw new Error('この版では扱えない項目が含まれています。物件情報専用のファイルを確認してください。');
  }
  for (const [key] of TRANSFER_FIELDS) {
    if (!Object.hasOwn(packet.project, key)) continue;
    if (typeof packet.project[key] !== 'string' || packet.project[key].length > 20000) throw new Error('物件情報の項目を読み取れません。');
    project[key] = packet.project[key];
  }
  return { format, schema_version: 1, source_project_id: packet.source_project_id, revision: packet.revision, project };
}

export function makeTransfer(project, selectedFields, revision = 1) {
  const fields = { name: project.project_slug };
  for (const [key] of TRANSFER_FIELDS) {
    const value = key === 'address' ? project.address : project.site_info?.[key];
    if (selectedFields.includes(key) && typeof value === 'string') fields[key] = value;
  }
  return parseTransfer(JSON.stringify({ format, schema_version: 1,
    source_project_id: project.project_id, revision, project: fields }));
}

// 表札(project_slug)は職人のもの。送り手の現場名は handoff_source.name に別に持ち、
// 新しい版を反映しても表札は書き換えない。最初の受取時だけ、職人が表札を決められる(空なら送り手の現場名)。
export function inspectTransfer(raw) {
  const packet = parseTransfer(raw), data = load();
  const receipts = (data.handoff_receipts ?? []).filter(r => r.packet.source_project_id === packet.source_project_id);
  const same = receipts.find(r => r.packet.revision === packet.revision);
  if (same) {
    if (JSON.stringify(same.packet) !== JSON.stringify(packet)) throw new Error('同じ物件ID・版で内容が異なります。元の記録は変更しません。渡し手に版を確認してください。');
    return { packet, action: 'received', project_id: same.project_id, current_slug: data.projects.find(p => p.project_id === same.project_id)?.project_slug };
  }
  if (receipts.some(r => r.packet.revision > packet.revision)) throw new Error('より新しい版を受け取っています。古い版では上書きしません。');
  const previous = receipts.sort((a, b) => b.packet.revision - a.packet.revision)[0];
  const current = previous && data.projects.find(p => p.project_id === previous.project_id);
  if (previous && !current) throw new Error('受取済みの現場が見つかりません。記録を確認してください。');
  return { packet, action: previous ? 'update' : 'add', project_id: previous?.project_id, current_slug: current?.project_slug };
}

export function acceptTransfer(raw, newId = crypto.randomUUID(), now = Date.now(), { slug } = {}) {
  const plan = inspectTransfer(raw);
  if (plan.action === 'received') return plan;
  if (slug != null && (typeof slug !== 'string' || slug.length > 200)) throw new Error('現場名を確認してください。');
  const data = load();
  let project = data.projects.find(p => p.project_id === plan.project_id);
  if (!project) {
    if (data.projects.some(p => p.project_id === newId)) throw new Error('現場IDが重複しています。');
    // 手入力の現場と同じ骨格(master_id は将来の台帳との結び口・今日は空)。IDの形式だけは受取用に別。
    project = { project_id: newId, project_slug: slug?.trim() || plan.packet.project.name, address: null, start_date: null,
      project_code: null, site_contact_id: null, master_id: null, site_info: {}, created_at: now, archive: false };
    data.projects.push(project);
  }
  project.site_info ??= {};
  for (const [key] of TRANSFER_FIELDS) {
    if (!Object.hasOwn(plan.packet.project, key)) continue;
    if (key === 'address') project.address = plan.packet.project[key];
    else project.site_info[key] = plan.packet.project[key];
  }
  project.handoff_source = { source_project_id: plan.packet.source_project_id, revision: plan.packet.revision, name: plan.packet.project.name };
  data.handoff_receipts ??= [];
  data.handoff_receipts.push({ project_id: project.project_id, received_at: now, packet: plan.packet, raw });
  save(data); // 現場と受取原本を一緒に保存。既存の記録と過去の版は保持。
  return { ...plan, project_id: project.project_id };
}
