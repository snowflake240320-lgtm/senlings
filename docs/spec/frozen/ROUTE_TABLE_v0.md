# ROUTE_TABLE_v0
## Senlings v0 Navigation Definition

## 原則
- 画面は増やさない
- 戻り先を必ず明示する
- モードは2つだけ（移動 / 現場）

---

## 0. ENTRY
`/`  →  `SiteSelectScreen`
※起動時は必ず現場選択へ。単純性優先。

---

## 1. SITE SELECT
`SiteSelectScreen`
- 操作: `onSelect(site_id)` → `TravelModeScreen(site_id)`

---

## 2. TRAVEL MODE（現場へ移動モード）
`TravelModeScreen(site_id)`
- 操作: 
    - `openMap()` → 外部GoogleMap
    - `arrivedButton` → `SiteModeScreen(site_id)`
    - `cancel` → `SiteSelectScreen`

---

## 3. SITE MODE（現場モード）
`SiteModeScreen(site_id)`
- 操作:
    - `CameraButton` → `CameraScreen(site_id)`
    - `EndWorkButton` → `WorkSummaryScreen(site_id)`

---

## 4. CAMERA
`CameraScreen(site_id)`
- 動作: 写真撮影・自動保存
- 操作: `back` → `SiteModeScreen`

---

## 5. WORK SUMMARY
`WorkSummaryScreen(site_id)`
- 操作: `confirm` → `SiteSelectScreen`

---

## 6. INVOICE PREVIEW（v0 月末固定）
`InvoiceDraftScreen(site_id)`
- 操作:
    - `generateSnapshot()` → InvoiceSnapshot保存
    - `copyDraft()` → クリップボードコピー
    - `back` → `SiteSelectScreen`
