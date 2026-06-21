# Senlings — データ設計 MVP実装版 v7.2
_3点微修正：localStorage注記・プライベート写真注記・実装順のSTEP 2復活_

---

## 確定した設計判断（全履歴）

| # | 判断 | 結論 |
|---|------|------|
| 1 | properties と projects を分けるか | 分ける |
| 2 | handover の構造 | 2層（handoverBase + handoverOverride） |
| 3 | Hunter参加の持ち方 | assignmentsサブコレクション |
| 4 | 物件IDの採番 | autoID + displayName、重複は管理者が後から統合 |
| 5 | maintenanceTickets.propertyId | null許容 |
| 6 | handoverSnapshots | 別コレクション（設計だけ先に用意） |
| 7 | siteAliases | 書き込みはMVP初日から |
| 8 | helpSignals と maintenanceTickets | 最初から分ける |
| 9 | workSessions | MVPに残す |
| 10 | photos.storagePath | storagePath を正本、storageUrl はキャッシュ用 |
| 11 | handoverキー名 | entry → access |
| 12 | 経費の持ち方 | workSessions のサブコレクション expenses |
| 13 | 請求書H列工事名 | projects.title |
| 14 | 労務費単価 | 端末内localStorage、初期値25,000円/人工 |
| 15 | 単価のFirestore保存 | しない（Zero-Knowledge思想） |
| 16 | workSessions.propertyId | 冗長保持する |
| 17 | workSessions.status | "working" \| "returned" \| "closed" |
| 18 | helpSignals.fieldKey | enum固定（7種類） |
| 19 | photos.approvalStatus | "not_required" \| "pending" \| "approved" \| "rejected" |
| 20 | invoiceDrafts.workSessionIds | 追加（請求根拠・二重請求防止） |
| 21 | unitPriceのFirestore保存 | しない |
| 22 | invoiceDrafts.propertyId | 冗長保持する |
| 23 | siteAliases.aliasKey | 追加（正規化済み検索キー） |
| 24 | expenses.photoIds | 追加（レシート写真との紐付け） |
| 25 | workSessions.closedAt / closedBy | 将来候補、MVP実装は後回し |
| 26 | helpSignals.urgency | MVPでは保存しない。danger は表示ルールで強調のみ |
| 27 | Firebase Phone Auth費用 | 実装前に再確認 |
| 28 | 会計ソフト連携 | MVPはCSV出力まで。API連携は次フェーズ |
| 29 | properties.address / coords | null許容 |
| 30 | handoverBase / handoverOverride 各項目 | string \| null |
| 31 | invoiceDrafts.expenseIds | expenseRefs（sessionId + expenseId）に変更 |
| 32 | invoiceDrafts.taxRate | 追加（過去請求書の根拠保存） |
| 33 | Zero-Knowledge思想 | 暗号学的ゼロ知識証明ではない。注記を明文化 |
| 34 | projects.status "archived" | 将来候補。MVPは "active" \| "closed" のみ |
| 35 | helpSignals.aiCategory / aiSummary | 将来候補。MVPは fieldKey で十分 |

---

## データ自律思想（Senlingsの根幹）

Senlingsは、Hunterのデータを管理するためのツールではない。
Hunterが自分のデータを持ち、自分の意思で預け、自分の意思で持ち出せる設計にする。

### 原則

```
1. データの主はHunterである
   端末（localStorage）が正本。Firestoreは同期先・共有用。

2. クラウド同期はHunterが選ぶ
   強制同期しない。同期するかどうかはHunterの意思。

3. 離れるときはデータを持って出られる
   アプリをやめるとき、自分のデータをエクスポートして持ち出せる。
   データはSenlingsに人質にされない。

4. 管理者はデータを「持つ」のではなく「見せてもらう」
   HunterがFirestoreに預けたデータを、管理者は見ることができる。
   預けていないデータは見えない。
```

### データの流れ

```
端末（localStorage）← 正本
  ↓ Hunterが同期を選んだとき
Firestore ← 共有・バックアップ
  ↓ 管理者・リーダーが見る
管理画面
```

### エクスポート設計（必須機能）

HunterはいつでもSenlingsのデータをエクスポートできる。

| 形式 | 内容 |
|-----|-----|
| JSON | 全データ（workSessions・expenses・photos・helpSignals） |
| CSV | 月次・工事単位の記録 |
| Excel | 請求書（既存テンプレート） |

エクスポートはHunterの権利であり、課金・制限をかけない。

### localStorage と Firestore の役割分担（確定）

| 項目 | localStorage | Firestore |
|-----|-------------|-----------|
| 役割 | 正本・オフライン動作 | 同期・共有・バックアップ |
| 同期タイミング | Hunterが選ぶ | — |
| 読み取り権限 | Hunter本人 | Hunter＋管理者（預けた分のみ） |
| 削除 | Hunterが自由に削除できる | Hunterが削除を選んだとき同期 |

**localStorage → IndexedDB 移行余地：**
MVPではlocalStorageを正本として扱う。ただし写真・大量ログ・同期キューが増えた段階でIndexedDBへ移行できる余地を残す。構造はlocalStorageとIndexedDBで共通化できるよう設計する。

### 実装上の注意

- Firestoreへの移行は「上書き」ではなく「同期」として設計する
- localStorageのデータ構造（senlings_v0）はv7.1移行後も保持する
- オフライン環境でも全機能が動作することを前提とする
- Firestoreが使えない環境でもlocalStorageだけで完結できる

---

## データ自律思想に基づく実装順（確定）

```
STEP 0 : repo scan ✅完了
STEP 1 : Firebase setup and Phone Auth check
STEP 2 : 最小JSONエクスポート（データ自律思想の根幹として先に実装）
STEP 3 : users schema and assignments mirror
STEP 4 : Firestore security rules draft
STEP 5 : Firestore schema v7.2
STEP 6 : handover nullable merge
STEP 7 : workSessions create
STEP 8 : expenses subcollection
STEP 9 : siteAliases aliasKey
STEP 10: helpSignals create
STEP 11: photos approvalStatus
STEP 12: invoiceDrafts create
STEP 13: invoiceExport H and M columns
STEP 14: localStorage invoice settings
STEP 15: CSV export
```

**STEP 2を前倒しした理由：**
データ自律思想を本気で採用するなら、Firestore移行前に最低限のJSONエクスポートを置く。CSVは後でよい。まず「持ち出せる状態」を先に担保する。

---

## 設計原則

- properties（器）と projects（出来事）は分ける
- handoverは2層構造（施設固定 ＋ 工事差分）
- Hunter参加はassignmentsサブコレクション
- helpSignals = 現場中の救助信号 / maintenanceTickets = 竣工後のメンテ受付（混ぜない）
- workSessions = 今日の現場の器（入退場・写真・helpSignal・経費を束ねる）
- siteAliases = 職人語を物件IDへ寄せる核心（書き込みはMVP初日から）
- **Zero-Knowledge思想：労務単価などの計算条件はFirestoreに保存しない。端末内で計算した結果のみを保存する。暗号学的なゼロ知識証明とは異なる。**
- 職人は残すだけ。整理はAIと人がやる。
- 表は現場語、裏は管理語。キーは守る、ラベルは育てる。

---

## 開発環境・技術スタック（確定）

| 項目 | 内容 |
|-----|-----|
| OS / ターミナル | Windows / PowerShell |
| AIコーディングツール | Claude Code |
| フロントエンド | HTML + Vanilla JS |
| バックエンド | Firestore（Firebase）|
| ホスティング | Vercel |
| ソースコード管理 | GitHub |
| Firebaseプロジェクト | 新規作成から始める |

---

## 認証設計（確定）

| ユーザー種別 | 認証方式 |
|------------|---------|
| Hunter（職人） | Firebase Phone Authentication（SMS認証）|
| 管理者・親方 | Firebase Email/Password認証 |

- 60代の職人が2ステップで入れることを最優先
- **Firebase Phone Authの費用・制限は実装前に再確認すること**

---

## コレクション全体図

```
MVP実装
  properties               物件・現場（器）
  projects                 工事案件（出来事）
  └─ assignments           Hunter参加
  workSessions             今日の現場の器
  └─ expenses              経費
  helpSignals              現場中の救助信号
  photos                   写真（3種類）
  siteAliases              職人語 → propertyId 名寄せ ★核心
  invoiceDrafts            請求下書き

設計だけ先に用意（実装は後回し）
  workLogs
  maintenanceTickets
  handoverSnapshots
  interiorBomItems
```

---

## MVP実装コレクション

### `properties`　物件・現場（器）

```
properties/{propertyId}
  displayName   : string
  address       : string | null   ★null許容
  coords        : { lat: number, lng: number } | null   ★null許容
  handoverBase  : {
    specialEquipment : string | null
    parking          : string | null
    toilet           : string | null
    morningBriefing  : string | null
    delivery         : string | null
    access           : string | null
    workHours        : string | null
    contact          : string | null
  }
  createdBy     : string
  createdAt     : timestamp
  updatedAt     : timestamp
```

---

### `projects`　工事案件（出来事）

```
projects/{projectId}
  propertyId        : string
  title             : string
  projectCode       : string | null
  status            : "active" | "closed"   ★将来 "archived" 追加候補
  startDate         : string        YYYY-MM-DD
  endDate           : timestamp | null
  handoverOverride  : {
    specialEquipment : string | null
    parking          : string | null
    toilet           : string | null
    morningBriefing  : string | null
    delivery         : string | null
    access           : string | null
    workHours        : string | null
    contact          : string | null
  }
  createdBy         : string
  createdAt         : timestamp
  updatedAt         : timestamp
```

#### サブコレクション `projects/{projectId}/assignments/{hunterUid}`

```
  hunterUid   : string
  role        : "hunter" | "leader"
  joinedAt    : timestamp
```

#### 申し送りマージルール

```javascript
// getHandoverItems() で Base + Override をマージ
// Override が null でない項目だけ Base を上書き
// 表示は入力済み項目のみ（null は非表示）
// 表示優先順位：
// specialEquipment → parking → toilet → morningBriefing
// → delivery → access → workHours → contact
```

---

### `workSessions`　今日の現場の器

```
workSessions/{sessionId}
  projectId     : string
  propertyId    : string        冗長保持
  hunterUid     : string
  date          : string        YYYY-MM-DD
  status        : "working" | "returned" | "closed"

  startedAt     : timestamp
  returnedAt    : timestamp | null
  closedAt      : timestamp | null   将来候補
  closedBy      : string | null      将来候補

  coords        : { lat, lng } | null

  relatedHelpSignalIds : string[]
  relatedPhotoIds      : string[]

  createdAt     : timestamp
  updatedAt     : timestamp
```

#### サブコレクション `workSessions/{sessionId}/expenses/{expenseId}`

```
  sessionId  : string
  projectId  : string
  propertyId : string
  hunterUid  : string
  date       : string        YYYY-MM-DD
  category   : "parking" | "highway" | "fuel" | "train" | "shinkansen"
             | "flight" | "hotel" | "material" | "tool_rental"
             | "tool_purchase" | "shipping" | "communication" | "other"

// ローカル互換値の正規化（Firestore同期・CSV生成時に変換）
// toll           → highway
// material_small → material
  amount     : number        税抜
  status     : "draft" | "confirmed"
  memo       : string | null
  photoIds   : string[]      レシート写真との紐付け
  createdAt  : timestamp
  updatedAt  : timestamp
```

---

### `helpSignals`　現場中の救助信号

```
helpSignals/{signalId}
  sessionId     : string
  projectId     : string
  propertyId    : string

  fieldKey      : "access_delivery" | "drawing_diff" | "fit_unknown"
                | "contact_unknown" | "danger" | "question" | "other"
  fieldLabel    : string
  description   : string | null
  photoIds      : string[]

  moodKey       : string | null
  moodLabel     : string | null

  // urgency はMVPでは保存しない
  // fieldKey == "danger" のみUI上で強調表示する
  // 将来候補: aiCategory, aiSummary

  status        : "open" | "in_progress" | "resolved"
  resolvedAt    : timestamp | null

  createdBy     : string
  notifyTo      : string[]
  createdAt     : timestamp
  updatedAt     : timestamp
```

#### fieldKey → 管理語マッピング

| fieldKey | 現場語 | 管理語 |
|----------|--------|-------|
| access_delivery | 搬入・入館できない | 工程 |
| drawing_diff | 図面と違う | 品質 |
| fit_unknown | 納まりがわからない | 品質 |
| contact_unknown | 誰に聞けばいいかわからない | 工程 |
| danger | 危ない | 安全 |
| question | 確認したいことがある | 工程 |
| other | その他 | — |

---

### `photos`　写真（3種類）

**保存先の分岐（確定）**

| 種別 | 保存先 | 例 |
|-----|-------|----|
| 施工写真・共用資産 | Firebase Storage | 完成写真・工程写真・不具合記録・入口写真 |
| プライベート写真 | Senlingsの管理外 | 備忘メモ・個人用記録・レシート控え |

**プライベート写真の実装注記：**
プライベート写真はFirestoreに保存しない。PWAにおける端末への直接保存はブラウザ・OS・権限により動作差が出るため、MVPでは「Senlingsの管理外」として扱う。端末保存が難しい場合は、撮影・共有のみとし保存はしない。

```
photos/{photoId}
  projectId      : string
  propertyId     : string
  sessionId      : string | null
  uploaderUid    : string
  type           : "handover" | "work" | "memo"
                   handover = 入口・搬入口など申し送り用
                   work     = 施工記録・進捗（同現場のHunter全員が参照可能）
                   memo     = 備忘・レシートなど個人管理だがFirebase保存を選んだもの
  storagePath    : string        永続参照の正本
  storageUrl     : string | null 一時表示・キャッシュ用
  approvalStatus : "not_required" | "pending" | "approved" | "rejected"
                   handover → pending、work・memo → not_required
  caption        : string | null
  createdAt      : timestamp
```

---

### `siteAliases`　★ Senlingsの成功がかかっている核心

```
siteAliases/{aliasId}
  siteLabel      : string       職人が入力した現場名（原文）
  aliasKey       : string       正規化済み検索キー
  normalizedName : string | null
  propertyId     : string | null
  projectId      : string | null
  sourceUid      : string | null
  confidence     : number | null
  status         : "unmatched" | "suggested" | "confirmed" | "rejected"
  createdAt      : timestamp
  updatedAt      : timestamp
```

**aliasKeyの生成ルール：**
```javascript
aliasKey = siteLabel
  .replace(/\s/g, "")    // 空白除去
  .normalize("NFKC")     // 全角→半角、半角カナ→全角カナ
  .toLowerCase()         // 小文字化
// 将来候補：㈱/株式会社の正規化、略称対応、語順違い対応
```

---

### `invoiceDrafts`　請求下書き

```
invoiceDrafts/{invoiceId}
  invoiceId       : string
  projectId       : string
  propertyId      : string      冗長保持
  hunterUid       : string
  billingMonth    : string      YYYY-MM

  workSessionIds  : string[]    請求根拠・二重請求防止
  expenseRefs     : [           ★expenseIdsからexpenseRefsに変更
    { sessionId: string, expenseId: string }
  ]
  // expenseRefs は補助的な参照
  // 正式には workSessionIds から expenses サブコレクションを辿る

  status          : "draft" | "confirmed" | "sent" | "revised" | "void"
  version         : number

  taxRate         : number      ★追加（出力時の税率を保存。過去請求書の根拠）
  subtotalWork    : number      労務費合計（端末内単価×人工数、ローカル計算済み）
  subtotalExpense : number      経費合計
  subtotal        : number      税抜合計
  taxAmount       : number      消費税（切捨）
  total           : number      税込合計

  exportedAt      : timestamp | null
  exportFileName  : string | null
  pdfExportedAt   : timestamp | null
  pdfFileName     : string | null

  createdAt       : timestamp
  updatedAt       : timestamp
```

---

## PDFテンプレート設計（確定）

- 初期対応：藤田建装専用書式（`Invoice_Gen_WithDetails.xlsx`）
- 将来：複数テンプレートから選択できる設計
- 置き場：`web/public/templates/`

---

## CSVエクスポート設計（確定）

対象範囲：月次単位・工事単位の両方

```
仕舞い画面
  ├─ 月次エクスポート（YYYY-MM）
  └─ 工事単位エクスポート（projectId）
```

CSV列構成（freee / マネーフォワード共通形式）：
```
日付, 勘定科目, 金額（税抜）, 消費税, 摘要, 現場名, 工事コード
```

---

## Push通知設計（確定）

MVPでは実装しない。将来対応できる設計だけ残す。

| 項目 | 内容 |
|-----|-----|
| 通知基盤 | Firebase Cloud Messaging（FCM）|
| メール通知 | Resend（月3,000通無料）|
| 実装タイミング | ユーザーから要望が出たとき |

---

## 端末内設定（localStorage）

```
senlings_user_name              御社ご担当者名
senlings_work_unit_price        労務単価（初期値: 25000）
senlings_tax_rate               消費税率（初期値: 0.10）
senlings_invoice_closing_day    締め日
senlings_invoice_payment_days   支払サイト
senlings_bank_name              銀行名
senlings_bank_branch            支店名
senlings_bank_account_type      "普通" | "当座"
senlings_bank_account_number    口座番号
senlings_bank_account_holder    口座名義
senlings_invoice_number_prefix  請求書番号プレフィックス
senlings_registrated_number     インボイス登録番号（T+13桁、任意）
```

---

## usersコレクション設計（MVP）

### `users`　Hunterプロフィール

```
users/{uid}
  displayName   : string | null
  phoneNumber   : string | null
  email         : string | null
  role          : "hunter" | "leader" | "admin"
  createdAt     : timestamp
  updatedAt     : timestamp
```

**将来追加候補（MVPでは localStorage 優先）：**
```
invoiceName              : string | null
invoiceRegistrationNo    : string | null
companyName              : string | null
bankInfo                 : object | null
// defaultWorkUnitPrice は Zero-Knowledge思想により保存しない
```

### `users/{uid}/assignments`　現場一覧ミラー

Hunter本人が「今日はどこへ入りますか？」を速く表示するためのミラー。

```
users/{uid}/assignments/{projectId}
  projectId   : string
  propertyId  : string
  role        : "hunter" | "leader"
  status      : "active" | "closed"
  joinedAt    : timestamp
```

**2つのassignmentsの役割分担：**

| コレクション | 役割 |
|------------|-----|
| `projects/{projectId}/assignments` | 管理・権限判定用 |
| `users/{uid}/assignments` | Hunter本人の現場一覧表示用 |

**同期方針：**
- Cloud Functionsで同期するのが理想
- MVPでは管理者操作時に両方書き込む

---

## Firestoreセキュリティルール方針（MVP）

### 基本方針

```
Hunter  = 自分に関係する現場だけ読める
          自分のworkSessions / expenses / photos / helpSignals は作成できる
          他人の記録は読めない・書けない

leader  = 自分が参加しているproject内の記録を読める
          helpSignalsのstatus更新ができる

admin   = 全件読める・全件管理できる
```

### コレクション別ルール

| コレクション | Hunter | leader | admin |
|------------|--------|--------|-------|
| users/{uid} | 自分のみ読取・一部更新 | — | 全件 |
| users/{uid}/assignments | 自分のみ読取・書込不可 | — | 全件 |
| projects/assignments | 参加者は読取 | 担当project管理 | 全件 |
| workSessions | 自分のみ作成・読取・更新 | 担当project読取 | 全件 |
| expenses | 自分のworkSession配下のみ | 確認可 | 全件 |
| helpSignals | 自分のみ作成。notifyTo読取可 | 読取・status更新 | 全件 |
| photos（memo） | 本人のみ | — | 全件 |
| photos（work） | 作成可。project参加者読取 | 読取 | 全件 |
| photos（handover） | — | approved後読取 | 全件 |

**重要：** `users/{uid}/assignments` はHunterが自分で書けない。管理者・管理処理だけが書き込める。

---



**repo scanの確認項目：**
1. web/ 配下の構成
2. Firebase初期化ファイルの有無
3. Firestore読み書き処理の場所
4. invoiceExport.js の場所
5. localStorage設定処理の有無
6. 既存のworkSessions / photos / expenses相当の実装有無
7. 変更すべきファイル一覧

---

## 実装順（確定）

```
STEP 0 : repo scan ✅完了（結果は下記参照）
STEP 1 : Firebase setup and Phone Auth check
STEP 2 : 最小JSONエクスポート（データ自律思想の根幹として先に実装）
STEP 3 : users schema and assignments mirror
STEP 4 : Firestore security rules draft
STEP 5 : Firestore schema v7.2
STEP 6 : handover nullable merge
STEP 7 : workSessions create
STEP 8 : expenses subcollection
STEP 9 : siteAliases aliasKey
STEP 10: helpSignals create
STEP 11: photos approvalStatus
STEP 12: invoiceDrafts create
STEP 13: invoiceExport H and M columns
STEP 14: localStorage invoice settings
STEP 15: CSV export
```

### repo scan 結果サマリー（STEP 0完了）

| 項目 | 結果 |
|-----|-----|
| web/ 配下 | 既存実装あり |
| Firebase初期化 | `web/src/pwa/firebase.js`（SDK 10.14.1、config はハードコード） |
| Firestore使用コレクション | `projects` のみ。他はすべてlocalStorage管理 |
| invoiceExport.js | `web/src/pwa/invoiceExport.js` H列=project_slug、M列=経費合計のみ |
| localStorage | `senlings_v0`（全状態）・`senlings_user_name` の2キー |
| helpSignals / siteAliases / invoiceDrafts | 未実装 |
| vercel.json | あり（outputDirectory: web） |
| 環境変数ファイル | なし（Firebase configはハードコード） |

| # | 内容 | 状態 |
|---|-----|-----|
| 1 | Firebase Phone Auth費用・制限の確認 | 要確認 |
| 2 | Firestore スキーマ実装（全コレクション v7.1） | 未実装 |
| 3 | handoverBase / Override null許容の実装 | 未実装 |
| 4 | workSessions 作成処理 | 未実装 |
| 5 | expenses サブコレクション実装 | 未実装 |
| 6 | siteAliases aliasKey 生成処理 | 未実装 |
| 7 | helpSignals 作成処理 | 未実装 |
| 8 | photos approvalStatus 実装 | 未実装 |
| 9 | invoiceDrafts 作成処理 | 未実装 |
| 10 | invoiceExport H列を projects.title に修正 | 修正必要 |
| 11 | invoiceExport M列に労務費を追加 | 修正必要 |
| 12 | localStorage 読み書き実装 | 未実装 |
| 13 | CSVエクスポート実装（月次・工事単位） | 未実装 |

---

## 会計ソフト連携（別紙）

MVP：CSV出力 → freee / マネーフォワードへ手動インポート
次フェーズ：OAuth2.0による自動連携（freee優先）

freee会計APIとfreee請求書APIは別プロダクトのため、実装時に仕様を分けて確認すること。

---

## Senlingsの世界観

> 現場に入る前に、山の作法を届ける
> 現場で困ったとき、救助信号を上げる
> 現場を出るときに、痕跡を次の人へ返す

職人は残すだけ。整理はAIと人がやる。
表は現場語、裏は管理語。キーは守る、ラベルは育てる。
