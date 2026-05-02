# FILE_STRUCTURE_v0
## Senlings v0 Directory Structure

## 設計思想
- PWAはメイン実装（`web/` 配下）
- データ構造はUIから分離して管理
- CLIで把握できる深さ（3階層以内）

---

## ROOT 構成
- `/docs`: 聖典（設計書一式）
- `/web`: 演出基板（Webブラウザ実装・PWA）

---

## web/ 構成
- `web/index_v2.html`: 新UI メインHTML（`ui-v2` ブランチ以降）
- `web/app_v2.js`: 新UI メインJS（`ui-v2` ブランチ以降）
- `web/index.html`: 旧UI（保持）
- `web/app.js`: 旧UI（保持）
- `web/manifest.json`: PWAマニフェスト
- `web/favicon.ico`: アイコン

---

## 設計原則 (v0)
1. ロジックはUIに依存しない
2. 状態遷移は app_v2.js の showScreen / goTo* 関数で管理
3. 計算（工数・請求）はロジック関数のみで行う
4. UIは「描画」と「入力」に徹する
5. `docs/` がすべての正史である
