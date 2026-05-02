# INVOICE_SNAPSHOT_DETAIL_SPEC
## Senlings v0 - Invoice Snapshot (With Daily Detail)

## 1. 目的
請求Snapshotに日別明細を凍結保存し、将来にわたる完全な再現性と監査耐性を確保する。
「その瞬間の真実を凍結する」ことで、後日の修正に左右されない根拠資料とする。

## 2. Snapshot構造
- **基本属性**: `snapshot_id`, `project_id`, `generated_at`, `period_start/end`
- **集計項目**: `total_work_days`, `total_work_minutes`, `total_expense_amount` 等
- **明細項目**: `daily_breakdown` (DailySnapshotDetailの配列)
  - `date`, `work_minutes`, `transport_minutes`, `session_count`

## 3. 生成と不変性
- 生成時にその時点の `WorkSession` から `DailyWorkSummary` を生成し、配列としてコピー。
- **重要**: 保存後の Snapshot は、元データ（WorkSession）が変更・削除されても一切変化しない。

---

## 4. 設計思想
Senlingsは、事実を消さない。未来を書き換えない。過去を改ざんしない。
元請け、協力会社、税理士、あらゆるステークホルダーに対する「即答可能な誠実さ」を技術で担保する。
