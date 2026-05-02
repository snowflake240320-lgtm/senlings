# EVENT_LOG_v0
## Senlings v0 Event Log Specification

## 設計思想
- すべては「イベント」として記録する（追記のみ）
- 状態はイベントから再構築可能にする
- 「人生の記録」として、請求対象外のデータ（交通時間等）も捨てない

---

## 1. EventType 一覧 (v0)
- SITE_CREATED / SITE_UPDATED
- TRAVEL_STARTED / TRAVEL_ENDED
- WORK_STARTED / WORK_ENDED
- PHOTO_TAKEN
- EXPENSE_ADDED / EXPENSE_UPDATED
- INVOICE_SNAPSHOT_CREATED
- NOTE_ADDED

---

## 2. 設計原則
1. **不変性**: 一度起きたイベントは削除しない。
2. **再構築**: `WORK_STARTED` と `WORK_ENDED` の差分から勤怠を算出。
3. **証明可能性**: snapshot の根拠をイベント履歴で証明する。
4. **人生ログ**: 請求に使わない交通時間も「事実」として保持する。

---

## 3. なぜ Event Log なのか
- データの透明性とバグ追跡能力。
- 未来の自分（またはAI）が人生を振り返るための純粋なデータソース。
