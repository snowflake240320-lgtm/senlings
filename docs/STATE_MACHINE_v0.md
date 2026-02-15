# Senlings STATE_MACHINE_v0

## 状態一覧
- idle (未選択)
- selected (現場選択済)
- moving (移動中)
- onsite (現場内)
- closed (その日の作業終了)

---

## 状態遷移（正常系）
1. idle → selected (現場をタップ)
2. selected → moving (「移動を開始」タップ)
3. moving → onsite (「到着」タップ)
4. onsite → closed (「退場」タップ)
5. closed → idle (「完了」または翌日へ)

---

## 禁止遷移（バグ防止の壁）
- idle → onsite (現場を選ばずに現場入りは不可)
- moving → closed (移動中にいきなり終了は不可)
- onsite → moving (現場から移動中に戻ることはv0では考慮しない)

---

## 保持すべき主要フラグ
- currentSiteId (現在地の工事コード)
- mode (現在のState)
- travelStartTime (移動開始時刻)
- workStartTime (作業開始時刻)
- workEndTime (作業終了時刻)

---

## 設計原則
- 状態は必ず1つだけ（排他的状態管理）
- 同時に2つのフラグを持たない
- 例外（裏ルート）は作らない
- v0ではこの5つの状態を厳守する
