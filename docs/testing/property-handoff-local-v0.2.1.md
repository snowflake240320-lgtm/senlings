# 物件の受け渡しと簡易記録 v0.2.1 ― 藍(Claude Code)による引き取りと手直し

2026-10-23。`fix/attendance-restart-20261020` の続き。
基線 320baa3d(読取ガード・PR #5)→ Codex 版 4 コミット(zip v0.2.0・tree d7209ead)→ 藍の手直し。
別アプリは作らない。既存UI(ui-v2)の延長。main・PR・本番・遠隔には触れていない(push なし)。

**完了の範囲**:今回の「物件の受け渡し・簡易記録・勤怠再起動修正」の範囲の完了。請求全体・全データJSONからの復元・記録の訂正/削除など、従来からの残件が解消した意味ではない。この文書は藍の隔離検証の報告であり、第三者の検品完了・push/merge/本番反映の許可ではない。

## 物差し(変わらず)

- 第十条:押すか、押せか。入口は名前ひとつ。確認も催促もしない。
- 第九条:職人の画面は職人の言葉だけ。
- 正は人に。自動はドラフトまで。原文は消さない。IDは杭、動かさない。表札は職人のもの。
- 記録は事実を壊さず置く器。自動修復しない。送るか・何を送るかは職人の手。

## Codex 版(v0.2.0)の採否

| # | 内容 | 採否 | 手直し・理由 |
|---|---|---|---|
| 1 | 退勤を再起動安全に(`completeSession`:勤怠追加と入場解除を一回の保存。同じ入場は現場ID+入場時刻で照合。複数候補は停止) | 採用 | 事実を壊さず置く。自動修復しない。再起動7群で確認 |
| 2 | 物件情報の受取(ファイル/貼り付け→確認→現場に追加/新版反映。同一版は増やさない。同一版で内容違いは停止。古い版は拒否) | 採用・手直し | **表札を書き換えない形に修正**(下記)。受け取った現場も手入力と同じ骨格(master_id: null ほか) |
| 3 | 物件情報の選択書き出し(選んだ項目だけ。メモ・写真・勤怠・請求・受取履歴は含まない。版) | 採用 | 文言のみ(「照合用ID」) |
| 4 | 私的メモ(端末内・private・not_sent) | 採用(簡易版) | |
| 5 | 縮小写真(長辺1280px JPEG・1枚70万字・合計300万字・端末内) | 採用(簡易版) | 実機未確認 |
| 6 | SOS:端末内保存+連絡文の準備(コピー/テキスト/電話番号があれば電話) | 採用・手直し | 空の電話ボタンの不具合を修正。文言(下記)。送る文から本人向け注意書きを外した |
| 7 | 帰還(山返し)の本人メモ:勤怠の `personal_note` + 旧版途中保存からの復旧 | 採用 | 「残しておきたいこと」「自分のメモ」「今日の記録を、保存しました。」は、送る仕組みが無い実態に合わせた変更。元の「次のHunterへ、届きます」は事実と違っていたため戻さない(言い回しは船長の手で) |
| 8 | 自分の記録を見返す(仕舞い。個別にテキスト/縮小写真を書き出せる) | 採用 | |
| 9 | 工事別CSVを新UIへ接続(現場を選ぶダイアログ) | 採用 | |
| 10 | 設定画面(旧UIと同じ9欄。`data.settings` に一回で保存。旧キーは読める。全データJSONに含む) | 採用・範囲整理 | 今回使う口=お名前(Excel)・単価(Excel/CSV)・税率(CSV)を表に。登録番号・口座5欄は「保管のみ」として畳む。メール宛先・月の選択は含めない(棚のまま) |
| 11 | 現場追加に住所・担当者・電話(任意)を追加 | 採用・畳む | 入口は名前ひとつ+貼り付け。3欄は「住所・担当者・電話も入れる（任意）」の中へ。電話はSOSの電話ボタンに使う |
| 12 | 現場トップ見出し直下の「物件情報を受け取る」ボタン | 採用・位置変更 | 「現場が見つからない場合」の導線に並べた(新版の反映もここから) |
| 13 | 申し送りの「担当者へ確認する」「この物件の情報を渡す」 | 採用・見た目変更 | 控えめな行に。入館ボタンと競わせない |
| 14 | 仕舞い確認モーダルの文言 | 採用・微修正 | 「入ったままになります。保存した記録は残ります。」 |
| 15 | 試験の初期化待ち/SOS文のCSS | 採用 | |

## 藍の手直し(コミット単位)

- e7e558f **表札は職人のもの**:新しい版を反映しても `project_slug` を書き換えない。送り手の現場名は `handoff_source.name` に別に持つ(出口の紙で揃える将来の手がかり)。最初の受取時だけ「この端末での現場名」を決められる(空なら送り手の名前)。新版の画面は「現場名はそのまま：○○（送り手の現場名：△△）」。
- 9d95f17 **主要操作の整合**:入口の畳み/受取導線の位置/申し送りの行/SOS完了の空ボタン修正(`.sos-modal-btn[hidden]`)と「危ないときは、待たずに」の保持/文言。
- 4788c43 設定画面の範囲整理。
- b102393 受取プレビューに住所・担当者・原文が出ることの試験(RUNBOOK 操作2)。
- 228d769 受け取った現場の骨格を手入力と揃える(IDの形式は受取用に別のまま)。

## ID形式の混在(読むだけの調査・結果:調査範囲では形式依存を発見せず)

- 三つの形式がある:旧UIの注記 `{YYYYMMDD}_{slug}`(project.js)、新UI手入力 `{YYYYMMDD}_{Date.now()}`、受取 UUID。
- IDを解析・分割・並べ替え・比較に使う箇所は無い(app_v2 / app / src / master を検索)。IDは一致判定にだけ使われる。
- 唯一の見た目の違い:写真ファイル名 `{project_id}_{YYYYMMDD}_{HHMMSS}.jpg` にIDが入るため、受取現場の写真名が長くなる(ハイフン入り)。
- 既存の値はすべて保持。変更なし。「実害なし」は、調査したコード範囲(web/app_v2.js・web/app.js・web/src/pwa・src/pwa・web/master)で形式依存を見つけなかった、という範囲に限る。

## 試験と RUNBOOK 8 操作の対応

隔離プロファイル・架空データ・外部通信遮断・Service Worker 遮断。実データ・本番・既存プロファイルは使わない。

| 操作 | 内容 | 根拠(試験) |
|---|---|---|
| 1 | 新規プロファイルで `web/index.html` をローカルHTTPで開く | すべてのブラウザ試験 |
| 2 | 架空の物件JSONを受け取り、現場名・住所・担当者・原文を確認して追加 | local-features 群2(プレビュー内容・保存失敗→再試行・表札) |
| 3 | 同じJSONを再度受け取っても現場が増えない | local-features 群3(再起動後)・群4(新版:表札そのまま・原文保持) |
| 4 | 入場し、メモ・縮小写真・SOSを端末内に保存 | local-features 群5・6・7 |
| 5 | 完全終了→開き直し→「続きから入る」。入場時刻と記録 | local-features 群8、attendance-restart 7群 |
| 6 | 仕舞いの帰還からメモ付きで退勤。再起動後も勤怠1件 | local-features 群8、attendance-restart |
| 7 | 記録を1件だけ書き出す。物件書き出しに私的記録が混じらない | local-features 群1・群9 |
| 8 | 全データJSONに別現場・請求・未知フィールドが保たれる | local-features 群9、browser.cjs(読取ガード) |

証拠の索引(原物で追うとき):

- `evidence/local-features-browser.log`:群ごとの PASS 行(群名は `evidence/local-features-result.json` の `results[]` と同じ順)。
- `evidence/local-features-result.json`:`source_commit`(85b7786)・`working_tree`(空=未コミット差分なし)・`chromium`・群の合否。
- `evidence/local-features-readback.json`:全11群のあとの `senlings_v0` 読戻し(受取現場の `project_slug`=自分の呼び名・`handoff_source.name`=送り手の名、`handoff_receipts` 2件、`local_records`、`photos` 1件、`work_sessions` 1件、既存現場 `old` の `future: KEEP`、`settings`)。
- 再起動前後の同一データ:`restart()` は閉じる前の生バイトと開き直した後の生バイトが等しいことを assert する(群3・8・10)。ログに PASS があれば、その群の再起動前後で `senlings_v0` が1バイトも変わっていない。
- `evidence/attendance-restart-result.json` + `evidence/attendance-restart.log`:7群の合否と件数(`attendance_before/after`・`checkout_write_count`・`all_other_data_preserved`)。読戻し原物は `normal-before.json` → `normal-readback.json`、`normal-fail-write-after.json`/`normal-fail-read-after.json`(失敗時に不変)、`legacy-exact-after.json`、`rich-legacy-before.json` → `rich-legacy-after.json`、`ambiguous-unchanged.json`(重複勤怠は自動整理せず不変)。
- `evidence/browser-regression.log`:既存画面61件(読取ガード・旧UI含む)。`evidence/node.log`:Node 74件。
- `evidence/screens/01〜28`:画面の歩き(`tools/walkthrough.cjs`)。`evidence/property-receive.png`・`property-revision.png`・`property-export.png`・`sos-unsent.png`・`personal-records.png`・`site-top.png`:試験中の画面。

保護4条件:勤怠の重複防止(attendance-restart 7群・Node attendance)/他データ保持(browser.cjs 61・local-features 群9・Node storage)/保存失敗時の保護(local-features 群2・5・6・7・10、Node local-features)/再起動後の読戻し(local-features 群3・8・10、attendance-restart)。

再実行:

```
node tests/check.mjs
PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM_PATH=/path/to/chrome-headless-shell node tests/browser.cjs
PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... SENLINGS_EVIDENCE=/path/to/evidence node tests/attendance-restart.cjs
PLAYWRIGHT_MODULE=... CHROMIUM_PATH=... SENLINGS_EVIDENCE=/path/to/evidence node tests/local-features-browser.cjs
```

環境の事象(観測):フルChrome(`chrome` バイナリ)の headless では、`tests/local-features-browser.cjs` の第7群のあと最初のダウンロード完了直後に、ブラウザ本体プロセスが SIGSEGV で終了した(3回とも再現。`evidence/baseline/env-note-full-chrome-download-sigsegv.log`)。`chrome-headless-shell` では再現せず、11群すべて合格。**原因は未確定。環境差あり。** アプリ側の操作(ダウンロードの直後の処理など)が引き金である可能性は排除できていない。ブラウザ試験は headless-shell で統一し、この事象は残件として持ち越す。

## 船長の決定(2026-10-23 夜)

1. 山返し/SOS 完了の文言:**探索中**(船長)。それまで事実を言う今回の文言のまま。言い回しが決まったら文言だけの小さな手直し。
2. 「物件情報を受け取る」の置き場所:**このまま**(「現場が見つからない場合」の導線)。
3. 口座・登録番号の畳み:**このまま**(保管のみ)。
4. 順番:**船長の iPhone 実機で 8 操作 → PR #5(読取ガード→ui-v2)→ fix ブランチ → PR #4(ui-v2→main)は最後。本番の舵は船長。**
5. 「一旦、完成」:この範囲(物件受渡し・簡易記録・勤怠再起動修正)はここで区切る。

## 残件(本人実機・棚)

- **本人 iPhone 実機**:写真の選択/対応形式、コピー、ダウンロード(ファイルの保存先)、電話画面、PWA オフライン起動、Service Worker 更新。未実施。
- 到達確認:仕組みとして持たない(設計どおり)。SOS は「残す・用意する」まで。
- 複数タブの同時更新、既に複数ある重複勤怠の自動整理:しない(必須条件に入れない)。
- 全データJSONからの一括復元画面/個人記録の訂正・削除UI/配布済みファイルの回収:未実装。
- 請求:月の選択の口、工事コード・担当者名の口、テンプレート L18 の目視(船長)、口座の転記(テンプレート側の設計が先)。
- 地図/周辺検索は凍結中。
- 遠隔:fix ブランチは GitHub に無い。置く手は船長(または藍に push 権限)。PR #4(ui-v2→main)・PR #5(読取ガード→ui-v2)は Open のまま。
- 統合先(案・船長判断):fix は 320baa3d(PR #5 の先頭)の直系の子孫で、ui-v2 先頭 ee9f4df9 からも一本線(ee9f4df9 → 320baa3d → Codex 4 → 藍 6)。筋は「PR #5 を ui-v2 へ → fix を ui-v2 へ(fast-forward 可)→ 最後に PR #4 で main へ」。ui-v2 先頭からの最終差分は 40 files / +2259 / −152(うち読取ガード 22 files、Codex 25 files、藍 8 files・重なりあり)。この報告は push・merge・本番反映の許可ではない。
