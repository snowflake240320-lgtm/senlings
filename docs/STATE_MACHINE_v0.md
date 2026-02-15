# STATE_MACHINE_v0
## Senlings v0 State Definition

## 原則
- 状態は最小限
- 自動遷移しない（ユーザー操作のみ）
- 同時に複数状態を持たない

---

## 0. GLOBAL STATES (AppState)
1. Idle (待機)
2. Travel (移動中)
3. OnSite (現場作業中)
4. Reviewing (確認・要約)

---

## 1. Idle
- **説明**: 起動直後、現場未選択。
- **遷移**: `selectSite(site_id)` → `Travel`

---

## 2. Travel
- **保持**: `current_site_id`
- **操作**: 
    - `pressArrived()` → `OnSite`
    - `cancel()` → `Idle`

---

## 3. OnSite
- **保持**: `current_site_id`, `work_start_time`, `photo_count`
- **操作**:
    - `takePhoto()` → 状態維持
    - `endWork()` → `Reviewing`

---

## 4. Reviewing
- **保持**: `today_work_minutes`, `today_expense_total`
- **操作**: `confirm()` → `Idle`

---

## 5. Invoice Snapshot (Event)
- 状態変化を伴わない「事実の固定」アクション。

---

## 6. 禁止事項 (v0 Guardrails)
- GPSによる自動状態遷移
- OnSite中の別現場切り替え
- Reviewingのスキップ（けじめの欠如）
