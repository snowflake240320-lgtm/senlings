# STATE_MACHINE_v0
## 請求確定フロー統合版

## 1. 状態遷移図
stateDiagram-v2
    [*] --> Idle
    Idle --> Moving : 現場選択
    Moving --> OnSite : 到着
    OnSite --> Working : 現場に入る
    Working --> OnSite : 作業中断/写真確認
    OnSite --> Moving : 現場を出る
    Moving --> Idle : 帰宅

    Idle --> InvoiceReview : 請求下書き表示
    InvoiceReview --> SnapshotReady : 下書き生成(Snapshot)
    SnapshotReady --> Warning : 経費未確定(unconfirmed)
    Warning --> Confirmed : 承知の上で確定
    SnapshotReady --> Confirmed : 確定(confirmed/skipped)
    Confirmed --> Idle : 完了

## 2. 経費状態の「けじめ」
- **confirmed**: 経費入力済。そのまま確定可。
- **skipped**: 「今月は請求しない」と決断済。0円として確定可。
- **unconfirmed**: 未入力の可能性あり。必ず警告を出し、0円ではないことを明示する。

## 3. 監査証跡
- 全ての遷移は EventLog に記録される。
- Snapshot 生成時に `source_hash` を生成し、改ざんを防止する。
