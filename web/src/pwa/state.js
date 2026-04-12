/**
 * state.js — 実行状態管理（モード・現在プロジェクト）
 * STATE_MACHINE_v0 に基づく
 */

export const Mode = Object.freeze({
  IDLE:            "Idle",
  MOVING:          "Moving",
  ON_SITE:         "OnSite",
  WORKING:         "Working",
  INVOICE_REVIEW:  "InvoiceReview",
  SNAPSHOT_READY:  "SnapshotReady",
  WARNING:         "Warning",
  CONFIRMED:       "Confirmed",
});

// 有効な遷移マップ
const TRANSITIONS = {
  [Mode.IDLE]:           [Mode.MOVING, Mode.INVOICE_REVIEW],
  [Mode.MOVING]:         [Mode.ON_SITE, Mode.IDLE],
  [Mode.ON_SITE]:        [Mode.WORKING, Mode.MOVING],
  [Mode.WORKING]:        [Mode.ON_SITE],
  [Mode.INVOICE_REVIEW]: [Mode.SNAPSHOT_READY],
  [Mode.SNAPSHOT_READY]: [Mode.WARNING, Mode.CONFIRMED],
  [Mode.WARNING]:        [Mode.CONFIRMED],
  [Mode.CONFIRMED]:      [Mode.IDLE],
};

let _mode = Mode.IDLE;
let _projectId = null;

export function getMode() {
  return _mode;
}

export function getProjectId() {
  return _projectId;
}

/**
 * モードを遷移する。無効な遷移はエラーをスローする。
 * @param {string} nextMode - Mode 定数
 * @param {string|null} projectId - 現場選択時に渡す
 */
export function transition(nextMode, projectId = null) {
  const allowed = TRANSITIONS[_mode] ?? [];
  if (!allowed.includes(nextMode)) {
    throw new Error(`Invalid transition: ${_mode} → ${nextMode}`);
  }
  _mode = nextMode;
  if (projectId !== null) _projectId = projectId;
  if (nextMode === Mode.IDLE) _projectId = null;
}

/**
 * デバッグ・テスト用: 状態を強制リセット
 */
export function reset() {
  _mode = Mode.IDLE;
  _projectId = null;
}
