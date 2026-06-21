# DAILY_TOTAL_SPEC
## Senlings v0 - Daily Total Time Specification

## 1. 目的
- 1日に複数現場を回る職人の「総稼働時間」を可視化・保存する。
- 請求（短期）と人生ログ（長期）を分離し、将来の働き方改善の基礎データとする。

## 2. 保存データ (DailyWorkSummary)
- `date`: YYYY-MM-DD
- `total_work_minutes`: 請求対象時間の合計
- `total_transport_minutes`: 移動時間の合計（請求対象外）
- `total_active_minutes`: work + transport の総和
- `session_count`: 1日の現場数
- `generated_at`: 生成タイムスタンプ

## 3. 計算とタイミング
- **タイミング**: `WorkSession` の終了時・編集時・手動再計算時に更新。
- **ロジック**: その日の全 `WorkSession` から各項目を合算。

---

## 4. 設計思想
請求は短期。人生は長期。
移動時間は請求には乗らないが、確実に人生を消費している「事実」である。
Senlingsはこの「事実」を捨てず、収益構造再設計のための基礎データとして保持し続ける。
