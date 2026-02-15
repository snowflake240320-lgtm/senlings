# FILE_STRUCTURE_v0
## Senlings v0 Directory Structure

## 設計思想
- PWAは試作だが、捨てない
- Flutterは将来の主戦場
- データ構造は共通（UIからロジックを分離）
- CLIで把握できる深さ（3階層以内）

---

## ROOT 構成
- `/docs`: 聖典（設計書一式）
- `/core`: メイン基板（ロジック・モデル・計算）
- `/pwa`: 演出基板A（Webブラウザ実装）
- `/flutter`: 演出基板B（ネイティブ実装）

---

## 設計原則 (v0)
1. core はUIに依存しない
2. PWAとFlutterはcoreの思想を共有する
3. 状態遷移は state_machine のみが一括管理
4. 計算（工数・請求）は logic 配下のみで行う
5. UIは「描画」と「入力」に徹する
6. `docs/` がすべての正史である
