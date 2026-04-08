/**
 * photo.js — 写真メタデータ管理
 * PHOTO_CAPTURE_SPEC / PHOTO_LOG_SPEC_v0 に基づく
 *
 * 実体（JPEG）はブラウザのダウンロードとして保存。
 * メタデータ + サムネイル（base64）を localStorage に保持。
 */

import { load, update } from "./storage.js";

/**
 * ファイル名を生成する。
 * 形式: {project_id}_{YYYYMMDD}_{HHMMSS}.jpg
 * @param {string} projectId
 * @returns {{ filename: string, takenAt: number }}
 */
export function buildPhotoFilename(projectId) {
  const now  = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const hh   = String(now.getHours()).padStart(2, "0");
  const mm   = String(now.getMinutes()).padStart(2, "0");
  const ss   = String(now.getSeconds()).padStart(2, "0");
  return {
    filename: `${projectId}_${date}_${hh}${mm}${ss}.jpg`,
    takenAt:  now.getTime(),
  };
}

/**
 * 写真メタデータを保存する。
 * @param {object} meta
 * @param {string} meta.id
 * @param {string} meta.project_id
 * @param {string} meta.filename
 * @param {string} [meta.atmosphere] - 100文字以内の任意テキスト
 * @param {string} [meta.thumbnail]  - base64 DataURL（表示用縮小版）
 * @param {number} meta.taken_at     - timestamp (ms)
 */
export function savePhotoMeta(meta) {
  update((data) => {
    data.photos.push({ ...meta, deleted: false });
    data.event_log.push({
      type:       "PHOTO_TAKEN",
      photo_id:   meta.id,
      project_id: meta.project_id,
      filename:   meta.filename,
      at:         meta.taken_at,
    });
    return data;
  });
}

/**
 * 指定プロジェクトの写真一覧を返す（削除済み除く）。
 * @param {string} projectId
 * @returns {object[]}
 */
export function listPhotos(projectId) {
  const { photos } = load();
  return photos.filter((p) => p.project_id === projectId && !p.deleted);
}

/**
 * 写真を論理削除する（event_log に記録）。
 * @param {string} photoId
 */
export function deletePhoto(photoId) {
  const now = Date.now();
  update((data) => {
    const photo = data.photos.find((p) => p.id === photoId);
    if (!photo) throw new Error(`Photo not found: ${photoId}`);
    photo.deleted = true;
    data.event_log.push({
      type:     "PHOTO_DELETED",
      photo_id: photoId,
      at:       now,
    });
    return data;
  });
}
