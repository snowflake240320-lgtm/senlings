// photoSync.js
// localStorageのphotosメタデータをFirestoreのphotosへ同期する
// 注意：base64画像データはFirestoreに保存しない。メタデータのみ同期する。

import { savePhoto } from './firebase.js';

function getLocalPhotos() {
  const raw = localStorage.getItem('senlings_v0');
  if (!raw) return [];
  const data = JSON.parse(raw);
  return data.photos ?? [];
}

/**
 * localStorageのphotoをFirestoreのphotosスキーマへ変換する
 *
 * photo.js のフィールド対応:
 *   local.id          → photoId
 *   local.project_id  → projectId
 *   local.atmosphere  → caption  （photo.js では caption でなく atmosphere）
 *   local.taken_at    → createdAt（ms タイムスタンプ）
 *   local.thumbnail   → 除外     （base64はFirestoreに保存しない）
 *   propertyId / sessionId / uploaderUid / type / storagePath / storageUrl
 *                     → photo.js にフィールドなし → null / デフォルト値
 */
function toFirestorePhoto(local) {
  return {
    photoId:     local.id          ?? null,
    projectId:   local.project_id  ?? null,
    propertyId:  null,
    sessionId:   null,
    uploaderUid: null,
    type:        local.type        ?? 'work',
    storagePath: null,
    storageUrl:  null,
    caption:     local.atmosphere  ?? null,
    createdAt:   local.taken_at    ?? null,
  };
}

/**
 * すべての photos メタデータを Firestore へ同期する
 * base64画像データは除外する
 */
export async function syncPhotosToFirestore() {
  const photos = getLocalPhotos();
  if (photos.length === 0) return { synced: 0 };

  let synced = 0;
  const errors = [];

  for (const photo of photos) {
    try {
      const fsData = toFirestorePhoto(photo);
      await savePhoto(fsData);
      synced++;
    } catch (err) {
      errors.push({ photo, err: err.message });
    }
  }

  return { synced, errors };
}
