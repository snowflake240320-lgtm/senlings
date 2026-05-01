// workSync.js
// localStorageのwork_sessionsをFirestoreのworkSessionsへ同期する

import { saveWorkSession } from './firebase.js';

/**
 * localStorage の work_sessions を読み出す
 */
function getLocalWorkSessions() {
  const raw = localStorage.getItem('senlings_v0');
  if (!raw) return [];
  const data = JSON.parse(raw);
  return data.work_sessions ?? [];
}

/**
 * localStorageのwork_sessionをFirestoreのworkSessionsスキーマへ変換する
 *
 * work.js の実際のフィールド:
 *   id, project_id, check_in_at (ms), check_out_at (ms),
 *   break_minutes, travel_start_at? (ms), travel_end_at? (ms)
 */
function toFirestoreWorkSession(local) {
  return {
    sessionId:            local.id ?? null,
    projectId:            local.project_id ?? null,
    propertyId:           null,
    hunterUid:            null,
    date:                 local.check_in_at
                            ? new Date(local.check_in_at).toISOString().slice(0, 10)
                            : null,
    status:               mapStatus(local),
    startedAt:            local.check_in_at  ? new Date(local.check_in_at)  : null,
    returnedAt:           local.check_out_at ? new Date(local.check_out_at) : null,
    coords:               null,
    relatedHelpSignalIds: [],
    relatedPhotoIds:      [],
  };
}

/**
 * check_out_at の有無でステータスを判定する
 * work.js にはステータスフィールドが存在しないため導出する
 */
function mapStatus(local) {
  return local.check_out_at ? 'returned' : 'working';
}

/**
 * すべての work_sessions を Firestore へ同期する
 * localStorageが正本。Firestoreへの書き込みのみ。削除はしない。
 */
export async function syncWorkSessionsToFirestore() {
  const sessions = getLocalWorkSessions();
  if (sessions.length === 0) return { synced: 0, errors: [] };

  let synced = 0;
  const errors = [];

  for (const session of sessions) {
    try {
      const fsData = toFirestoreWorkSession(session);
      await saveWorkSession(fsData);
      synced++;
    } catch (err) {
      errors.push({ session, err: err.message });
    }
  }

  return { synced, errors };
}
