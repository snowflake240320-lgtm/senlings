/**
 * project.js — Project CRUD
 * DATA_MODEL_v0 / PROJECT_REGISTRATION_FLOW に基づく
 *
 * - project_id = {YYYYMMDD}_{slug} （変更不可）
 * - 削除不可（archive=true による論理削除のみ）
 * - 変更不可フィールド: project_id, start_date
 */

import { load, update } from "./storage.js";

/**
 * project_id を生成する。
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} slug      - 英数字・ハイフンのみ
 * @returns {string}
 */
export function buildProjectId(startDate, slug) {
  const datePart = startDate.replace(/-/g, "");
  return `${datePart}_${slug.toUpperCase()}`;
}

/**
 * slug のバリデーション（英数字・ハイフン・20文字以内）。
 * @param {string} slug
 * @returns {string|null} エラーメッセージ、問題なければ null
 */
export function validateSlug(slug) {
  if (!slug) return "現場略称は必須です";
  if (slug.length > 20) return "現場略称は20文字以内にしてください";
  if (!/^[a-zA-Z0-9\-]+$/.test(slug)) return "現場略称は英数字・ハイフンのみ使用できます";
  return null;
}

/**
 * Project を保存する。
 * @param {object} project
 * @param {string}  project.project_id
 * @param {string}  project.project_slug
 * @param {string}  project.start_date      - YYYY-MM-DD
 * @param {string}  project.address
 * @param {string}  [project.project_code]
 * @param {string}  project.site_contact_id - CM01〜CM10
 * @param {object}  [project.site_info]     - 攻略情報
 * @param {number}  project.created_at      - timestamp (ms)
 */
export function saveProject(project) {
  const { projects } = load();
  if (projects.some((p) => p.project_id === project.project_id)) {
    throw new Error(`project_id already exists: ${project.project_id}`);
  }

  update((data) => {
    data.projects.push({ ...project, archive: false });
    data.event_log.push({
      type:       "project_created",
      project_id: project.project_id,
      at:         project.created_at,
    });
    return data;
  });
}

/**
 * archive していない全 Project を返す。
 * @returns {object[]}
 */
export function listProjects() {
  const { projects } = load();
  return projects.filter((p) => !p.archive);
}

/**
 * Project を論理削除する。
 * @param {string} projectId
 */
export function archiveProject(projectId) {
  const now = Date.now();
  update((data) => {
    const p = data.projects.find((p) => p.project_id === projectId);
    if (!p) throw new Error(`Project not found: ${projectId}`);
    p.archive = true;
    data.event_log.push({ type: "project_archived", project_id: projectId, at: now });
    return data;
  });
}

/**
 * 変更可能フィールドを更新する。
 * project_id と start_date は変更不可。
 * @param {string} projectId
 * @param {object} patch
 */
export function updateProject(projectId, patch) {
  const IMMUTABLE = ["project_id", "start_date"];
  const forbidden = Object.keys(patch).filter((k) => IMMUTABLE.includes(k));
  if (forbidden.length > 0) {
    throw new Error(`変更不可フィールド: ${forbidden.join(", ")}`);
  }

  const now = Date.now();
  update((data) => {
    const idx = data.projects.findIndex((p) => p.project_id === projectId);
    if (idx === -1) throw new Error(`Project not found: ${projectId}`);
    data.projects[idx] = { ...data.projects[idx], ...patch, updated_at: now };
    data.event_log.push({ type: "project_updated", project_id: projectId, patch, at: now });
    return data;
  });
}
