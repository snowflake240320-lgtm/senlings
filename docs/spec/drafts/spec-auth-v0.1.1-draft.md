# Senlings 認証設計

**spec-auth.md v0.1.1**

最終更新：2026-05-02
ステータス：ドラフト確定（実装前最終形）

---

## 1. 基本思想

認証は、現場を止めるための門ではない。
現場に安全に入るための準備である。

Senlings では、本人確認よりも先に、**現場参加権限**が重要である。

「その人が誰か」だけでなく、
「その人が、今日この現場に入ってよいか」を確認する。

---

## 2. 設計憲章

> **現場の安全・記録は止めない。**
> **お金・本人情報・持ち出しは確認する。**

この一文を Senlings 認証設計の最上位に置く。
すべての判断は、この憲章に照らして決める。

---

## 3. 認証の5層モデル

Senlings の認証は5層で構成される。
ただし MVP で深く実装するのは 1〜3 層。
4 と 5 は最小限でよい。

| # | 層 | 問い | MVP実装 |
|---|---|---|---|
| 1 | Account Identity | その人は誰か | ◎ |
| 2 | Device Trust | この端末を日常利用端末として扱うか | ◎ |
| 3 | Project Access | 今日この現場に入ってよいか | ◎ |
| 4 | Session State | 今日の作業セッションをどう扱うか | △（最小限） |
| 5 | Recovery / Transfer | 端末変更・紛失時に戻れるか | △（再招待のみ） |

---

## 4. データモデル

### 4.1 users

その人の Account Identity。
主IDは電話番号ではなく `uid`。
電話番号は確認・連絡・復旧用の属性として持つ。

```
users/{uid}
  displayName       : string
  phoneNumber       : string | null

  phoneVerified     : boolean
  phoneVerifiedAt   : timestamp | null
  phoneRecheckDueAt : timestamp | null

  createdAt         : timestamp
  updatedAt         : timestamp
```

**phoneRecheckDueAt の扱い：**
この時刻を過ぎても `phoneVerified` は `false` にしない。
「再確認の推奨タイミング」であって「失効」ではない。

---

### 4.2 userDevices

Device Trust を表現する。
一度確認した端末では、毎回ログインさせない。

```
users/{uid}/devices/{deviceId}
  deviceId          : string
  deviceName        : string | null

  trusted           : boolean
  trustedAt         : timestamp
  lastSeenAt        : timestamp

  trustExpiresAt    : timestamp | null
  needsRecheck      : boolean

  createdAt         : timestamp
  updatedAt         : timestamp
```

**trustExpiresAt の扱い：**
期限が来ても、現場操作中の強制ログアウトは行わない。
仕舞い・設定・重要操作の前に再確認を促す。

---

### 4.3 invites

現場参加への招待。
**現場コードを主、招待リンクを副**とする。
現場コードは複数人が利用する前提で設計する。

```
invites/{inviteId}
  projectId         : string
  propertyId        : string

  inviteType        : "code" | "link"
  inviteCodeHash    : string | null

  issuedBy          : string
  issuedToPhone     : string | null

  role              : "hunter" | "leader" | "admin"

  status            : "active" | "used" | "revoked" | "expired"

  maxUses           : number | null
  usedCount         : number
  usedBy            : string | null
  usedByList        : string[]

  expiresAt         : timestamp
  usedAt            : timestamp | null

  createdAt         : timestamp
  updatedAt         : timestamp
```

**フィールドの使い分け：**

| フィールド | 用途 |
|---|---|
| `maxUses` | `null` = 上限なし、`number` = 使用回数上限 |
| `usedCount` | 現在の使用回数（コード使用ごとにインクリメント） |
| `usedBy` | 単発招待リンク用。特定ユーザー向けの場合に使う |
| `usedByList` | 現場コードの複数利用監査用。使った人の uid 配列 |

**inviteType ごとの使い分け：**

| inviteType | 用途 | 使用管理 |
|---|---|---|
| `code` | 朝礼・紙・口頭で共有する現場コード | `maxUses` / `usedCount` / `usedByList` |
| `link` | LINE等で送る招待リンク | `usedBy` または `usedByList` |

**status の扱い：**

| 状態 | 条件 |
|---|---|
| `active` | 利用可能。`maxUses` 未到達かつ `expiresAt` 未到達 |
| `used` | `maxUses` に到達した |
| `expired` | `expiresAt` を過ぎた |
| `revoked` | 管理者が停止した |

**将来拡張：**
人数規模が大きい現場で `usedByList` が肥大化する場合、サブコレクション化を検討する。

```
invites/{inviteId}/uses/{uid}
  uid
  usedAt
```

MVP では `usedByList` で十分。

---

### 4.4 assignments

Project Access を表現する。
Senlings 認証の中心。
ログインできることよりも、現場に参加していることが重要。

```
projects/{projectId}/assignments/{uid}
  hunterUid           : string
  role                : "hunter" | "leader" | "admin"
  joinedAt            : timestamp

users/{uid}/assignments/{projectId}
  projectId           : string
  propertyId          : string
  role                : "hunter" | "leader" | "admin"
  status              : "active" | "closed"
  joinedAt            : timestamp

  displayNameOverride : string | null
```

**displayNameOverride：**
将来拡張。MVP では使わない。
表示名の決定ルール（将来実装時）：

```js
const displayNameForProject =
  assignment.displayNameOverride || user.displayName;
```

---

### 4.5 workSessions

Session State。MVP では深追いしない。
設計メモとして残す。

```
workSessions/{sessionId}
  projectId      : string
  propertyId     : string
  hunterUid      : string

  date           : string
  status         : "planned" | "working" | "returned" | "closed"

  checkInAt      : timestamp | null
  checkOutAt     : timestamp | null

  createdAt      : timestamp
  updatedAt      : timestamp
```

MVP 後の検討事項：
同じ Hunter・同じ project・同じ date で `working` の workSession がある場合、
別端末から入った時の挙動を決める。

```
作業中の記録があります。
[続きから使う]
[新しく始める]
```

初期 MVP では自動再開でよい。

---

### 4.6 rateLimits

SMS送信と現場コード入力の乱用を防ぐ。
Firebase 側の標準制限に依存しきらず、Senlings 側でも制限を設ける。

**電話番号別 SMS 送信制限：**

```
rateLimits/sms_phone_{phoneHash}
  phoneHash        : string
  attemptsToday    : number
  attemptsHour     : number
  lastAttemptAt    : timestamp
  blockedUntil     : timestamp | null
  updatedAt        : timestamp
```

電話番号そのものをドキュメントIDにせず、ハッシュ化する。

**IP別 SMS 送信制限：**

```
rateLimits/sms_ip_{ipHash}
  ipHash           : string
  attemptsHour     : number
  lastAttemptAt    : timestamp
  blockedUntil     : timestamp | null
  updatedAt        : timestamp
```

**現場コード誤入力制限：**

```
rateLimits/invite_code_{deviceOrIpHash}
  attempts          : number
  failedAttempts    : number
  lastAttemptAt     : timestamp
  blockedUntil      : timestamp | null
  updatedAt         : timestamp
```

---

## 5. 初回登録フロー

### 5.1 現場コードを入れる

```
現場コードを入れてください。

職長・担当者から共有されたコードです。

入力例：8492
```

招待リンクから来た場合は現場コードが自動入力される。

```
現場コードが入力されています。
```

---

### 5.2 現場を確認する

```
この現場で合っていますか？

三井アウトレットパーク福岡C棟
外壁塗装

[この現場に入る]
[違います]
```

---

### 5.3 現場で呼ばれる名前

```
現場で呼ばれる名前を入れてください。

例：園原 / ソノさん / 木村
```

「本名」ではなく、現場で呼ばれる名前を入れる。

---

### 5.4 電話番号確認

```
本人確認のため、電話番号を確認します。

現場連絡と、端末を替えたときの確認に使います。

[SMSを受け取る]
```

電話番号を主IDにしないことを補足で示す。

---

### 5.5 端末を使いやすくする

```
次から、ひらくだけで使えます。

[この端末で使う]
```

「端末を信頼する」とは言わない。
動作の説明であり約束として伝える。

---

### 5.6 申し送りへ

```
入る前に、ここだけ確認

[申し送りを見る]
```

初回登録後、すぐ現場トップへ。

---

## 6. 再確認ルール

### 6.1 基本

180日を目安に、電話番号の再確認を推奨する。
**ただし、現場操作は止めない。**

### 6.2 データ表現

```
phoneVerified     : true
phoneVerifiedAt   : timestamp
phoneRecheckDueAt : timestamp
```

`phoneRecheckDueAt` を過ぎても、`phoneVerified` は `false` にしない。

### 6.3 止めない操作（現場タブ）

- 申し送りを見る
- 迷ったら送る
- 撮る・残す
- 今日を返す
- SOS
- 山返し
- 仕舞い（タブ確認まで）

### 6.4 確認する操作（仕舞い側・設定側）

- 請求書確定
- 電話番号変更
- 端末引き継ぎ
- 個人データエクスポート
- 重要な設定変更

### 6.5 再確認時の文言

```
本人確認が必要です。

現場の操作は止めません。
仕舞いの前に確認してください。
```

---

## 7. 復旧フロー

### 7.1 第一層：即応復旧（再招待）

職長・管理者による再招待。

- 端末をなくした
- スマホを変えた
- SMS が使えない
- 現場当日で急ぐ

このケースでは、職長・管理者が現場コードまたは個別招待リンクを再発行する。

### 7.2 第二層：自律復旧（引き継ぎコード）

仕舞い後に、希望者へ提案する。

```
引き継ぎコードを残しておけます。
端末を替えたときに、自分で戻れます。

[引き継ぎコードを残す]
[あとで]
```

送付先：

```
[LINEで自分に送る]
[メールで送る]
[コピーする]
```

**初回登録時には出さない。**
仕舞い完了後（働いた実感がある瞬間）に提案する。
MVP では実装後回しでよい。

---

## 8. 現場コード仕様

### 8.1 形式

MVP では数字 4〜6 桁でよい。

```
8492
```

### 8.2 セキュリティ要件

- 期限を短くする（デフォルト：当日中または翌日まで）
- プロジェクト単位で発行する
- 使い回しを無制限にしない（`maxUses` を必ず設定）
- `role` を限定する
- 必要なら当日限りにする

### 8.3 推奨 maxUses

| 現場規模 | 推奨値 |
|---|---|
| 小規模（〜10名） | `maxUses: 10` |
| 中規模 | `maxUses: 30` |
| 大規模 | `maxUses: 50` |

管理者が必要に応じて変更可能。

---

## 9. 運用方針

### 9.1 現場コードの複数利用

現場コードは複数人が使う前提。
朝礼や紙・口頭での共有を想定する。

```
今日の現場コードは 8492 です。
まだ入ってない人は今のうちに入ってください。
```

`maxUses` / `usedCount` / `usedByList` で管理する。

### 9.2 SMS送信のレート制限

| 対象 | 制限 |
|---|---|
| 同一電話番号 | 1時間に3回まで、24時間に5回まで |
| 同一IP | 1時間に5回まで |

制限到達時の文言：

```
確認コードを何度か送りました。
少し時間をおいて、もう一度お試しください。
```

### 9.3 現場コード誤入力のロック

5回連続で誤入力した場合、30分ロック。

文言：

```
現場コードを確認してください。
何度か間違えたため、少し時間をおいて再入力してください。
```

### 9.4 コスト防衛

SMS は思想以前にコストの問題がある。
Firebase 側の標準制限に依存しきらず、Senlings 側でも制限を設ける。

想定脅威：

- 同じ電話番号への連続SMS要求
- ランダム電話番号への大量試行
- 現場コード総当たり
- 引き継ぎ目的の連打

放置すると SMS 費用が膨らむだけでなく、無関係な人に SMS が飛ぶ。

### 9.5 表示名の扱い

MVP では `users.displayName` 1つで割り切る。
将来拡張として `assignments.displayNameOverride` を入れられる余白を残す。

---

## 10. Session State（MVP後の検討事項）

別端末からのログイン時、進行中 workSession の扱いを決める必要がある。

```
作業中の記録があります。
[続きから使う]
[新しく始める]
```

初期 MVP では自動再開でよい。

Hunter に触ってもらった後の論点として残す。

---

## 11. 最終設計判断

1. LINE 型の軽さは採用する
2. 電話番号中心主義は採用しない
3. 現場コードを主導線にする
4. 招待リンクは補助導線にする
5. SMS は初回確認と重要変更時に使う
6. 日常利用は端末を信頼する
7. 180日再確認は「推奨」であり「失効」ではない
8. 現場の安全・記録は止めない
9. お金・本人情報・持ち出しは確認する
10. 復旧は初回リカバリーキーではなく、まず再招待
11. 自律復旧は仕舞い後に提案する
12. Session State は MVP 後に整理する
13. SMS送信と現場コード入力には Senlings 側でレート制限を設ける

---

## 12. 最終文言

```
現場コードで入る。
SMSで確認する。
次から、ひらくだけで使える。

現場の安全・記録は止めない。
お金・本人情報・持ち出しは確認する。

現場コードは複数人で使える。
SMSは乱発させない。
名前は現場に合わせて育てられる。
```

---

## 改訂履歴

| バージョン | 日付 | 変更内容 |
|---|---|---|
| v0.1 | 2026-05-02 | 初版（4層モデル・基本思想・初回登録フロー） |
| v0.1.1 | 2026-05-02 | 5層モデル化、invites 複数利用対応、rateLimits 追加、phoneRecheckDueAt 追加、displayNameOverride 余白追加、運用方針章追加 |
