// helpSignal.js
// 救助信号の作成・Firestore保存ロジック

import { saveHelpSignal } from './firebase.js';

// 現場語 → fieldKey マッピング
export const HELP_SIGNAL_OPTIONS = [
  { fieldKey: 'access_delivery', label: '入れない・搬入できない' },
  { fieldKey: 'drawing_diff',    label: '図面と違う' },
  { fieldKey: 'fit_unknown',     label: '納まりがわからない' },
  { fieldKey: 'contact_unknown', label: '誰に聞けばいいかわからない' },
  { fieldKey: 'danger',          label: '危ない' },
  { fieldKey: 'question',        label: '確認したいことがある' },
  { fieldKey: 'other',           label: 'その他' },
];

/**
 * fieldKey から表示ラベルを取得する
 */
export function getFieldLabel(fieldKey) {
  const option = HELP_SIGNAL_OPTIONS.find(o => o.fieldKey === fieldKey);
  return option?.label ?? fieldKey;
}

/**
 * 救助信号を Firestore に保存する
 * @param {object} params
 * @param {string} params.fieldKey      - 選択されたfieldKey
 * @param {string} params.sessionId     - workSession ID
 * @param {string} params.projectId     - project ID
 * @param {string} params.propertyId    - property ID
 * @param {string} params.createdBy     - Hunter の uid
 * @param {string|null} params.description - ひとこと（任意）
 * @param {string[]} params.photoIds    - 写真ID一覧（任意）
 * @param {string[]} params.notifyTo    - 通知先uid一覧
 */
export async function createHelpSignal({
  fieldKey,
  sessionId,
  projectId,
  propertyId,
  createdBy,
  description = null,
  photoIds    = [],
  notifyTo    = [],
}) {
  if (!fieldKey) throw new Error('fieldKey は必須です');

  const fieldLabel = getFieldLabel(fieldKey);

  const signalId = await saveHelpSignal({
    sessionId,
    projectId,
    propertyId,
    fieldKey,
    fieldLabel,
    description,
    photoIds,
    status:    'open',
    createdBy,
    notifyTo,
  });

  return signalId;
}

/**
 * danger の場合は強調表示フラグを返す
 * urgency はFirestoreに保存しない。UI表示ルールのみ。
 */
export function isDanger(fieldKey) {
  return fieldKey === 'danger';
}
