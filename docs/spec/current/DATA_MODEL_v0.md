# DATA_MODEL_v0
## Senlings v0 Data Models

## 1. Project (現場)
現場の「攻略」の軸となる単位。

- `project_id`: string (Format: `{start_date}_{project_slug}`) 
  - ※工事コードを含めない（後日発番に対応するため）
  - 例: `20260215_MINATOMIRAI`
- `project_code`: string? (後日入力可・変更履歴保存)
- `project_slug`: string (英数字ハイフンのみ)
- `start_date`: YYYY-MM-DD (変更不可)
- `address`: string
- `billing_contact_id`: string (v0では自分/自社で完全固定)
- `site_contact_id`: string (ContactMasterから選択)

## 2. ContactMaster (現場窓口マスター)
協力会社側の窓口。v0では「いつもの10人」程度を固定登録。自由入力させない。

- `contact_id`: string
- `name`: string
- `role`: string
- `phone`: string?
- `company`: string?
- `active`: boolean

## 3. WorkSession (勤怠)
- `id`: string
- `project_id`: string
- `check_in_at`: timestamp
- `check_out_at`: timestamp
- `break_minutes`: number
- `travel_start_at`: timestamp? (保存のみ)
- `travel_end_at`: timestamp? (保存のみ)

## 4. Expense (経費)
- `id`: string
- `project_id`: string
- `expense_date`: YYYY-MM-DD
- `category`: string (enum: parking, toll, fuel, material_small, tool_rental, other)
- `amount`: number
- `memo`: string?
- `created_at`: timestamp

## 5. InvoiceSnapshot (請求下書き)
- `id`: string
- `project_id`: string
- `project_code`: string? (生成時点のコードをスナップショット化)
- `period_start`: YYYY-MM-DD
- `period_end`: YYYY-MM-DD
- `total_work_minutes`: number
- `total_days`: number
- `total_expenses`: number
- `generated_at`: timestamp
