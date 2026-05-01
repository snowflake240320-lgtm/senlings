// siteAlias.js
// 職人が入力した現場名を siteAliases コレクションに蓄積する

import { saveSiteAlias } from './firebase.js';

/**
 * aliasKey を生成する
 * 空白除去・全角→半角・小文字化
 */
export function generateAliasKey(siteLabel) {
  return (siteLabel ?? '')
    .replace(/\s/g, '')
    .normalize('NFKC')
    .toLowerCase();
}

/**
 * localStorageのprojectsから現場を読み出す
 *
 * project.js の実際のフィールド:
 *   project_id, project_slug, start_date, address,
 *   project_code?, site_contact_id, site_info?, created_at, archive
 *   ※ name フィールドは存在しない
 */
function getLocalProjects() {
  const raw = localStorage.getItem('senlings_v0');
  if (!raw) return [];
  const data = JSON.parse(raw);
  return data.projects ?? [];
}

/**
 * 現場名を siteAliases に登録する
 * 同じ aliasKey が既にあれば上書き（merge）される
 */
export async function registerSiteAlias(siteLabel, projectId, propertyId, uid) {
  if (!siteLabel) return;
  await saveSiteAlias({
    siteLabel,
    propertyId: propertyId ?? null,
    projectId:  projectId  ?? null,
    sourceUid:  uid        ?? null,
    status:     'unmatched',
  });
}

/**
 * localStorageの全projectsのslug・addressを siteAliases に登録する
 * MVP初日から蓄積するための一括登録関数
 *
 * 登録するラベル:
 *   - project_slug（現場略称）
 *   - address（住所）
 *   ※ name フィールドは存在しないため除外
 */
export async function syncProjectLabelsToSiteAliases(uid) {
  const projects = getLocalProjects();
  if (projects.length === 0) return { synced: 0, errors: [] };

  let synced = 0;
  const errors = [];

  for (const project of projects) {
    const labels = [
      project.project_slug,
      project.address,
    ].filter(Boolean);

    for (const label of labels) {
      try {
        await registerSiteAlias(label, project.project_id, null, uid);
        synced++;
      } catch (err) {
        errors.push({ label, err: err.message });
      }
    }
  }

  return { synced, errors };
}
