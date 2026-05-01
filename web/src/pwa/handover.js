// handover.js
// handoverBase と handoverOverride をマージして表示用データを返す

// 表示順の定義
export const HANDOVER_KEYS = [
  { key: 'specialEquipment', label: '特殊装備・入場条件' },
  { key: 'parking',          label: '駐車場' },
  { key: 'toilet',           label: 'トイレ' },
  { key: 'morningBriefing',  label: '朝礼' },
  { key: 'delivery',         label: '搬入' },
  { key: 'access',           label: '現場アクセス' },
  { key: 'workHours',        label: '作業時間' },
  { key: 'contact',          label: '連絡先' },
];

/**
 * handoverBase と handoverOverride をマージする
 * Override が null でない項目だけ Base を上書きする
 * @param {object|null} base    - properties.handoverBase
 * @param {object|null} override - projects.handoverOverride
 * @returns {object} マージ済みの handover オブジェクト
 */
export function mergeHandover(base, override) {
  const merged = {};
  for (const { key } of HANDOVER_KEYS) {
    const baseVal     = base?.[key]     ?? null;
    const overrideVal = override?.[key] ?? null;
    merged[key] = overrideVal !== null ? overrideVal : baseVal;
  }
  return merged;
}

/**
 * マージ済み handover から、入力済み項目のみを返す
 * null の項目は除外する
 * @param {object} merged - mergeHandover() の戻り値
 * @returns {Array<{key, label, value}>} 表示用アイテム一覧
 */
export function getHandoverItems(merged) {
  return HANDOVER_KEYS
    .filter(({ key }) => merged[key] !== null && merged[key] !== '')
    .map(({ key, label }) => ({
      key,
      label,
      value: merged[key],
    }));
}

/**
 * Base と Override をマージして表示用アイテム一覧を返す（ショートカット関数）
 * @param {object|null} base
 * @param {object|null} override
 * @returns {Array<{key, label, value}>}
 */
export function buildHandoverItems(base, override) {
  const merged = mergeHandover(base, override);
  return getHandoverItems(merged);
}
