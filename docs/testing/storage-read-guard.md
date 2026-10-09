# 保存データの読取保護：検証記録

対象: `senlings_v0`。起点: `ee9f4df9f1df5c5d811a9a750d9d02969ef2aec4` (`ui-v2`)。

## 変更と範囲

- `web/src/pwa/storage.js` と既存の `src/pwa/storage.js` を同じ実装で保護。
  `read()` は absent / valid / unreadable を返す。`load()` は読取不能時に空値を返さず例外にする。
  欠落した既知配列は以前どおりメモリ上で補完するが、存在する不正な値は補正しない。
  配列・要素・既知の使用フィールド・current_session を確認し、未知のフィールドは保持する。
- `update()` の変更開始前と `save()` の書込み直前に再読取。読取例外と保存例外を別の型で伝える。
- 新 UI の現場追加を共通 update に接続。新旧 UI の共通ダイアログは読取不能を空表示と区別し、操作を止める。
  「保存データを再読取」は読取と再描画だけを行い、失敗した操作を自動再実行しない。
- 旧 UI の到着・退出は保存後に状態遷移。写真はメタデータ保存後にダウンロードを予約する。
  連絡先初期候補はメモリ上で提供し、起動時の seed 保存を除去。編集時に既存形式で保存する。
- JSON、CSV、Excel、請求下書き、既存同期モジュールのローカル読取も共通判定へ接続。
  同期・認証・Service Worker の機能追加や変更は行っていない。

調査した書込み経路: 新 UI の開始、Return の勤怠保存と入場解除、取消し、現場追加、請求生成、経費 skip。
旧 UI の登録、到着・退出イベント、退勤、経費、連絡先、写真メタデータ・削除、カメラエラーイベント、請求・skip。
モジュールの現場更新・archive、経費更新・削除、明示 seed、既存 Firestore 取込も update を通る。
`senlings_v0` への直接 setItem は共通 storage のみに集約。

## 実行

既存の Node 24、Chromium、環境内 Playwright 1.61.1 を使用。依存追加なし。

```sh
npm --prefix web run check
PLAYWRIGHT_MODULE=/workspace/senlings-tools/node_modules/playwright npm --prefix web run test:browser
git diff --check
```

他環境では既存 Playwright の解決先を `PLAYWRIGHT_MODULE`、Chromium を `CHROMIUM_PATH` で指定できる。
ブラウザ試験は一時ポートの localhost と新規 BrowserContext のみを使用し、外部通信・Service Worker を遮断。
旧 UI の Firebase モジュールは通常の試験ではネットワークを使わない stub とする。

## 期待値と結果（2026-10-09）

| 試験 | 期待値 | 結果 |
| --- | --- | --- |
| 起点の再現（メモリ内 Storage） | 壊れた JSON 後に旧 update が上書きする | setItem 1 回、元文字列不一致で再現 |
| Node 保存層 40 件（web とルート版） | 読取不能時は各更新 API が例外、書込み 0、文字列不変 | 合格 |
| キーなし・正常値・欠落配列 | 初回読取で保存しない、通常保存可能 | 合格 |
| 無効な root、配列、要素、使用フィールド、current_session | 空の正常状態として扱わない | 合格 |
| 正常 load 後の破損/getItem 例外、変更 callback 後の読取例外 | 書込み直前にも止まる | 合格 |
| setItem 例外 | write error、元文字列不変、確定・成功なし | 合格 |
| 新 UI/旧 UI ブラウザ試験 61 件 | 各操作の停止、エラー表示、保存文字列不変、正常導線維持 | 合格 |
| Return の2回目の読取/書込みだけ失敗 | 勤怠保存済み・解除未完了の表示、完了なし。同じ画面での再試行は勤怠を重複追加しない | 合格 |
| skip 保存後の snapshot 保存失敗 | skip は残るが請求成功カードなし | 合格 |
| JSON/CSV 正常出力、480 分集計、未知フィールド | 出力内容・集計・未知値を維持 | 合格 |
| Excel の読取不能 | CDN 読込前に止まる | 合格 |
| JS 構文・差分空白チェック | エラーなし | 合格 |

初期のブラウザ試験では旧 UI の非表示タブのセレクターでタイムアウトしたため、実際のタブ操作に修正。
追加した保存失敗試験で到着の状態遷移順序の不具合を検出し、修正後に最終差分で再実行した。
既存の lint / TypeScript / 集約チェックはなかったため、依存不要の構文検査と Node テストを `check` とした。

## 未検証・制約

実 CDN 試験:

```sh
TEST_FILTER='real Firebase' TEST_CDN=1 \
PLAYWRIGHT_MODULE=/workspace/senlings-tools/node_modules/playwright node tests/browser.cjs
```

`curl -I https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js` は HTTP 200。
しかし Chromium では Firebase の3モジュールが `net::ERR_CERT_AUTHORITY_INVALID` となり、旧 UI 起動を確認できなかった。
証明書検証・権限・ネットワーク設定は変更していない。HTTP 取得成功を画面試験合格とは扱わない。
Firestore、認証、メール、実カメラ、実 CDN を使った Excel 正常ダウンロード、本番デプロイは検証対象外。
実 DB や利用者データへの通信は行っていない。Vercel の結果は機能試験の根拠にしていない。

Return の二段書込みは非原子的。1回目成功後の失敗では勤怠と current_session が両方残る。
同じ Return 画面での再試行のみ重複を防ぐ。画面を離れる・再読込する場合の復旧や重複防止は今回の対象外。
経費 skip と請求生成も別々の保存で、後半が失敗しても skip は保存済みになり得る。
複数タブの同時書込みの排他や、別タブで valid な値へ変更された場合の競合解決は対象外。

## 戻し方

未マージなら draft PR を閉じて適用しない。取り消す場合は専用ブランチで変更コミットを `git revert` する。
main / ui-v2 へ直接 push しない。保存キー・保存形式の移行はなく、データ削除や初期化は不要。
