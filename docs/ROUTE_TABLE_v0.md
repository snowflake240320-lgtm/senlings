# Senlings ROUTE_TABLE_v0

## Entry (入口)
- `/` (Home) → `SiteSelectScreen`

---

## SiteSelect (現場選択)
- `SiteSelectScreen`
  - `onSelect(site_id)` → `TravelModeScreen`

---

## Travel Mode (移動モード)
- `TravelModeScreen`
  - `openMap()` → (外部アプリ: Google Maps)
  - `arrivedButton` → `SiteModeScreen`

---

## Site Mode (現場モード)
- `SiteModeScreen`
  - `CameraButton` → `CameraScreen`
  - `EndWorkButton` → `WorkSummaryScreen`

---

## Camera (撮影)
- `CameraScreen`
  - `savePhoto()`
  - `back` → `SiteModeScreen`

---

## Work Summary (日報・要約)
- `WorkSummaryScreen`
  - `showTime`
  - `showExpense`
  - `confirm` → `SiteSelectScreen`
