# CONTACT_MASTER_SPEC
## Senlings v0 現場窓口マスター仕様（完全固定）

## 1. 目的
現場窓口の入力ミス・表記ゆれ・電話誤記を防ぐ。
v0では「自由入力を排除」する。

---

## 2. 基本思想と管理方式
- 窓口は増やさない・入力させない・選ばせるだけ。
- 上限: 10人固定（初期登録時に確定）。
- 制限: 追加不可、削除不可（active=falseによる無効化のみ）。

---

## 3. データ構造とID仕様
- contact_id: CM01 〜 CM10 (固定長・ゼロ埋め・変更不可)
- name: string
- role: string
- phone: string?
- company: string?
- active: boolean
- created_at / updated_at

---

## 4. 登録・編集ルール
- 新規追加: ❌
- 削除: ❌
- 無効化（active=false）: ✅
- 名前・電話の修正: ✅
- 並び順変更: ❌

---

## 5. Projectとの関係とUX
- Project は必ず1つの site_contact_id (CM01〜CM10) を持つ（複数不可）。
- 登録画面ではプルダウン表示のみ（例: 現場管理者｜田中（090-xxxx-xxxx））。
- active=false は選択肢に表示しない。

---

## 6. EventLog記録
変更時は必ずログに記録し、誰がいつ電話番号を変えたかの「事実」を残す。
{
  "event_type": "CONTACT_MASTER_UPDATED",
  "contact_id": "CM03",
  "updated_fields": ["phone"],
  "timestamp": "ISO8601"
}

---

## 7. けじめ（設計上の核心）
窓口が揺れると、SMS誤送信、事故報告誤送信、クレーム、信頼低下に直結する。
v0は「安定」を取る。拡張（協力会社別分類、ギルド連携など）は後。
