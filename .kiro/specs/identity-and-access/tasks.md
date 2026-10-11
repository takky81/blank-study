# 実装計画

## Baseline Evidence

- 認証 UI とセッション境界: `src/features/auth/validation.ts`, `src/features/auth/validation.test.ts`, `src/features/auth/LoginPage.tsx`, `src/App.tsx`, `src/lib/supabase.ts`
- 所有者・ロール境界: `supabase/migrations/20260829000000_init.sql`, `20260830000000_import_material.sql`, `20260831000000_grants.sql`, `20260901000000_revoke_rpc_from_anon.sql`, `20260902000000_harden_functions.sql`, `20260903000000_material_summary.sql`, `20260904000000_sync_active_keywords.sql`
- 回帰証拠: `spec/tables/01-auth.jsonl`, `e2e/auth.spec.ts`, `e2e/db.ts`, `e2e/fixtures.ts`
- 実行確認: `src/features/auth/validation.test.ts` は 6 件すべて成功（2026-10-10）。所有者不一致書込、匿名テーブル操作、公開 user-data RPC の列挙型権限回帰は未実装。

- [x] 1. クライアントとテストの認証基盤を固定する
- [x] 1.1 公開設定だけでブラウザ用クライアントを初期化する
  - 接続先と publishable／anon key のどちらかを起動前に検査する。
  - 特権資格情報をブラウザの設定経路へ含めず、設定不足時は利用者が原因を特定できるエラーで起動を止める。
  - 公開クライアント資格情報だけで共有クライアントが生成される状態を完了条件とする。
  - _Boundary: SharedClient_
  - _Requirements: 5.3, 5.4, 5.5_

- [x] 1.2 E2E の準備と後片付けに特権クライアントを限定する
  - 特権資格情報をローカルテスト環境から取得し、ブラウザセッションへ渡さない。
  - 利用者作成、データ準備、後片付けだけを管理用クライアントに担わせる。
  - E2E fixture が UI 経由の通常ログインを使い、特権クライアントがテスト支援コード内だけに留まる状態を完了条件とする。
  - _Boundary: TestAdminClient_
  - _Requirements: 5.4, 5.6_

- [x] 2. ログイン入力と結果表示を固定する
- [x] 2.1 ログイン入力と通信失敗を純粋に判定する
  - 空欄判定とメール形式判定を分離し、メール形式は前後空白を除いて評価する。
  - 通信に到達しなかった失敗と、通常の資格情報エラーを区別する。
  - 正常、不正、空欄、前後空白、通信失敗のユニット回帰がすべて成功する状態を完了条件とする。
  - _Boundary: LoginValidation_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 2.4_

- [x] 2.2 認証要求と利用者向けログイン結果を制御する
  - 入力が揃わない間と処理中は送信を受け付けず、不正メールでは認証要求前に形式エラーを示す。
  - 認証へ渡すメールだけを trim し、未登録とパスワード不一致は同じ文言、通信失敗は別文言へ写像する。
  - 公開サインアップ導線を持たず、認証成功時は直接遷移せず認証状態イベントへ画面切替を委ねる。
  - 有効な入力で一度だけ認証要求が送られ、各結果で所定の画面状態になることを完了条件とする。
  - _Boundary: LoginPage, AuthClient_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. セッション状態で保護領域を切り替える
  - 起動時に保存済みセッションを確認し、確認中は保護領域を構築しない。
  - 認証状態変更を購読して有効セッションを復元し、未認証・ログアウト・失効時はログイン画面へ切り替える。
  - 購読解除をライフサイクルへ組み込み、保護 URL の直接表示も同じセッション境界で閉じる。
  - 有効なセッションでは科目一覧が表示され、セッションがなければ保護ルートより先にログイン画面が表示される状態を完了条件とする。
  - _Boundary: SessionGate, AuthClient_
  - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 4. データ層の所有者・ロール境界を固定する
- [x] 4.1 6つの利用者データテーブルを所有者一致へ制限する
  - 全対象テーブルに必須の所有者 ID と RLS を持たせる。
  - 読取・更新・削除は `USING`、作成・更新は `WITH CHECK` で現在利用者との一致を検査する。
  - 認証済み利用者が自分の行だけを読み書きでき、別利用者の行が返らず所有者不一致の書込が拒否される policy 定義を完了条件とする。
  - _Boundary: OwnerPolicies, UserTables_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 4.2 匿名・認証済み・テスト用特権ロールの既存権限を分離する
  - 認証済みロールには6テーブルの CRUD と現行の公開業務 RPC の実行だけを許可し、行単位判定は RLS に委ねる。
  - 匿名ロールから6テーブルの操作と現行の公開業務 RPC の実行権を剥奪する。
  - テスト用特権ロールのテーブル権限を E2E 支援用途として明示し、公開 RPC は呼出利用者の RLS に従う状態を完了条件とする。
  - _Boundary: RoleGrants_
  - _Requirements: 5.1, 5.2, 5.6_

- [x] 5. 認証・セッション・読取分離の既存回帰を接続する
  - 決定表の認証10ケースを、入力検証ユニットテストとブラウザ E2E へ対応付ける。
  - 正常ログイン、共通資格情報エラー、通信失敗、未認証 URL、ログアウト、保存トークン喪失、別利用者読取拒否を実利用者経路で確認する。
  - 回帰スイートがログイン画面、セッションゲート、共有クライアント、所有者ポリシーを横断し、既存10ケースを検証可能な状態を完了条件とする。
  - _Boundary: LoginValidation, LoginPage, SessionGate, TestAdminClient, OwnerPolicies_
  - _Depends: 1.1, 1.2, 2.1, 2.2, 3, 4.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.3, 3.4, 3.5, 3.6, 4.1, 4.4_

- [ ] 6. 未検証のデータ認可を統合テストで固定する
- [ ] 6.1 所有者不一致の作成を拒否する回帰を追加する
  - 6テーブルの外部キー前提を満たす有効 payload をテーブル駆動のケースとして用意する。
  - 認証済み利用者から別利用者の所有者 ID を指定して insert し、各 `WITH CHECK` が拒否することを検証する。
  - 全6テーブルで権限または行ポリシー違反となり、管理用クライアントの事後確認で不一致所有者の行が残らないテスト結果を完了条件とする。
  - _Boundary: OwnerPolicies, TestAdminClient_
  - _Depends: 1.1, 1.2, 4.1_
  - _Requirements: 4.2, 4.5_

- [ ] 6.2 所有者 ID を別利用者へ変更できない回帰を追加する
  - 認証済み利用者が所有する6テーブルの行を、外部キー前提を保ったままテーブル駆動で準備する。
  - 各行の所有者 ID を別利用者へ更新し、`WITH CHECK` が変更を拒否することを検証する。
  - 全6テーブルで更新が拒否され、管理用クライアントの事後確認でも元の所有者 ID が保たれるテスト結果を完了条件とする。
  - _Boundary: OwnerPolicies, TestAdminClient_
  - _Depends: 1.1, 1.2, 4.1, 6.1_
  - _Requirements: 4.2, 4.5_

- [ ] 6.3 別利用者の既存行を更新・削除できない回帰を追加する
  - 管理用クライアントで別利用者が所有する6テーブルの関連行を準備する。
  - 認証済み利用者から識別子指定の update と delete を行い、各 `USING` により対象行へ到達できないことを検証する。
  - 全6テーブルで変更対象が0件となり、管理用クライアントの事後確認でも値と行が残るテスト結果を完了条件とする。
  - _Boundary: OwnerPolicies, TestAdminClient_
  - _Depends: 1.1, 1.2, 4.1, 6.1_
  - _Requirements: 4.2, 4.3, 4.5_

- [ ] 6.4 匿名ロールのテーブル読取拒否を回帰へ追加する
  - 公開資格情報だけでセッションを持たない匿名クライアントを生成する。
  - 匿名クライアントから6テーブルへ select し、空集合ではなく権限拒否になることを直接検証する。
  - 全6テーブルで読取権限が拒否され、利用者データを1件も取得できないテスト結果を完了条件とする。
  - _Boundary: RoleGrants, TestAdminClient_
  - _Depends: 1.1, 1.2, 4.2_
  - _Requirements: 5.1_

- [ ] 6.5 匿名ロールのテーブル書込拒否を回帰へ追加する
  - 管理用クライアントで6テーブルの有効な関連行と書込 payload を準備する。
  - 匿名クライアントから insert、update、delete を行い、全操作が権限拒否になることを直接検証する。
  - 全6テーブルの3操作が拒否され、管理用クライアントの事後確認でも値と行数が変化しないテスト結果を完了条件とする。
  - _Boundary: RoleGrants, TestAdminClient_
  - _Depends: 1.1, 1.2, 4.2, 6.4_
  - _Requirements: 5.1_

- [ ] 6.6 公開 user-data RPC を列挙して権限漏れを検出する
  - DB に公開された user-data RPC と実行 grant を列挙し、固定件数ではなく現在の一覧を検査する。
  - 各 RPC で anon の実行権がなく、authenticated に必要な実行権があり、`SECURITY INVOKER` と空の `search_path` を維持することを検証する。
  - RPC の追加・削除で一覧が自動更新され、匿名 grant または未登録の公開 RPC があればテストが失敗する状態を完了条件とする。
  - _Boundary: RpcSecurityMatrix, RoleGrants_
  - _Depends: 1.1, 1.2, 4.2, 6.4_
  - _Requirements: 5.2, 5.7_

- [ ] 6.7 新規 RPC が利用する4主体セキュリティ harness を固定する
  - 下流の RPC 業務テストが、authenticated owner、cross-owner、anon、service role の同じ検証手順を利用できる helper を提供する。
  - `prepareAsServiceRole`、owner／cross-owner／anonの各invoke、`readBackAsServiceRole` と主体別assertionを型で必須にし、owner の成功結果、cross-owner の返却値と副作用の分離、anon の本体到達前拒否、service role の準備・事後確認限定を観測可能にする。
  - 現行 RPC の代表ケースと、追加予定 RPC の feature-owned E2E から共通 harness を呼び出せる状態を完了条件とする。
  - _Boundary: RpcSecurityMatrix, TestAdminClient_
  - _Depends: 6.6_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.6, 5.7_
