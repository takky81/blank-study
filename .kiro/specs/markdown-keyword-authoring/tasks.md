# 実装計画

## Baseline Evidence

- 記法と本文変換: `src/lib/keyword.ts`, `keyword.test.ts`, `body.ts`, `body.test.ts`, `markdown.ts`, `markdown.test.ts`
- editor UI: `src/features/editor/EditorPage.tsx`, `BodyEditor.tsx`, `Preview.tsx`, `KeywordDialog.tsx`, `src/components/MarkdownView.tsx`。`ConflictDialog.tsx` は app-shell 所有の利用契約。
- 保存境界: `src/features/editor/api.ts`, `overwrite.ts`, `overwrite.test.ts`。`src/lib/paged.ts` は catalog、`src/lib/submitGuard.ts` は app-shell 所有の利用契約。
- 共有突合の現状: 正答正規化は `src/lib/answer.ts`、planner は `src/features/transfer/match.ts` にあり、editor が下流 feature を参照するため、authoring 所有の `src/lib/keywordMatch.ts` への抽出が未完了。
- 永続化: `supabase/migrations/20260829000000_init.sql`, `20260904000000_sync_active_keywords.sql`
- 画面参照: `design/Editor.dc.html`, `EditorM.dc.html`, `KeywordDialog.dc.html`, `KeywordDialogM.dc.html`, `ConflictDialog.dc.html`, `ConflictDialogM.dc.html`
- 回帰資産: `spec/tables/05-editor-ui.jsonl` 17列、`06-keyword-syntax.jsonl` 16列、`07-keyword-id.jsonl` 7列、`08-save-normalize.jsonl` 12列、`09-save-overwrite.jsonl` 9列、`e2e/editor.spec.ts`
- 実行確認: 関連ユニット6ファイル87件、editor E2E 27件、型検査、production build がすべて成功（2026-10-10、build は既存の chunk size 警告のみ）。`npm run spec:coverage` は対象5表61/61列、全体289/289列を参照済みと判定した。
- E2E 前提: Node.js 24、`.env.local`、Docker、ローカル Supabase DB／Auth／REST、Playwright Chromium、`globalSetup` の利用者作成とデータ初期化、`workers: 1`、`fullyParallel: false`。
- 未検証ギャップ: 現行 `commitSave` は keywords upsert、chapters.body 更新、活性同期を別要求で行うため途中失敗時の原子性が未達。共通 submit guard のユニット検証はあるが editor の保存連打による単一要求を直接確認する E2E はない。

- [x] 1. キーワードと本文の純粋契約を固定する
- [x] 1.1 (P) キーワード記法の解析と ID 検証を実装・検証する
  - 1行内のトークン走査、順不同の既知キー、未知キー、重複キー、引用、連続引用符、空白、空要素、重複値を副作用のない規則に閉じる。
  - 小文字英数字6桁だけを有効な文書内 ID とし、認識不能な記述を本文として残す。
  - 記法と ID 境界値を扱う21件のユニットテストが成功する状態を完了条件とする。
  - _Boundary: KeywordSyntax_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.6_

- [x] 1.2 キーワード整形、採番、本文変換を実装・検証する
  - 正答、ID、タグ、誤答の順序と引用規則、教材内と同一処理内の衝突を避ける採番を固定する。
  - 全出現の縮約、章内先頭だけの展開、選択可否、ダイアログ確定可否、本文への反映と解除を純粋関数で提供する。
  - 本文変換を扱う30件のユニットテストが成功する状態を完了条件とする。
  - _Boundary: BodyTransform_
  - _Depends: 1.1_
  - _Requirements: 2.2, 2.3, 2.5, 2.6, 2.8, 2.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3_

- [x] 1.3 (P) Markdown サブセットと本文位置を解析・検証する
  - 見出し、段落、改行、箇条書き、引用、コード、強調、リンク、表、空欄を本文オフセット付きで解析する。
  - コード内の記法を解釈せず、画像記法を文字列のまま保ち、表内のキーワード区切りを列区切りと混同しない。
  - Markdown 解析を扱う20件のユニットテストが成功する状態を完了条件とする。
  - _Boundary: MarkdownParser_
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.3, 1.4, 1.5_

- [x] 2. editor の入力・プレビュー・ダイアログを接続する
- [x] 2.1 本文入力とプレビューを同じ編集状態へ接続する
  - 入力ごとのプレビュー追随、未保存表示、認識可能な記述のハイライト、操作可能な空欄を提供する。
  - 編集領域とプレビューの選択を本文オフセットへ対応付け、双方から同じキーワード作成フローを開始できる状態を完了条件とする。
  - _Boundary: BodyEditor, Preview, MarkdownView_
  - _Depends: 1.1, 1.2, 1.3_
  - _Requirements: 1.1, 1.2, 1.4, 1.7, 2.1, 2.4_

- [x] 2.2 キーワード編集ダイアログの確定・取消・解除を接続する
  - 正答、タグ、誤答選択肢を1行1件で編集し、空白行と重複を除く。
  - 正答0件では確定不可、取消では本文不変、解除では最初の正答を通常文字列へ戻し、確定では保存前の本文だけを変更する。
  - editor E2E で作成、既存空欄の読込、取消、解除を観測できる状態を完了条件とする。
  - _Boundary: KeywordDialog, EditorPage_
  - _Depends: 1.2, 2.1_
  - _Requirements: 2.1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9_

- [x] 2.3 レスポンシブ表示とスクロール境界を接続する
  - 未選択時は章選択案内を出し、広幅では3ペイン、狭幅では章／編集／プレビューの3タブを表示する。
  - 広幅の編集領域とプレビューをスクロール割合で同期し、章ツリーとページ全体のスクロールを分離する。
  - desktop と mobile のワイヤーフレームおよび editor E2E で表示状態を観測できることを完了条件とする。
  - _Boundary: EditorPage_
  - _Depends: 2.1_
  - _Requirements: 1.6, 1.8, 1.9_

- [x] 2.4 未保存状態、離脱保護、進行中操作ガードを接続する
  - 本文と保存済み本文の差だけで未保存を判定し、変更なしでは保存を無効にする。
  - 別章への移動とブラウザ離脱を確認し、保存中は同じ操作を重複実行しない。
  - submit guard 3件と editor の変更なし／章移動／ブラウザ離脱 E2E が成功する状態を完了条件とする。
  - _Boundary: EditorPage, SubmitGuardAdapter_
  - _Depends: 2.1_
  - _Requirements: 7.1, 7.4, 7.5, 7.6_

- [x] 3. 保存準備、衝突解決、活性同期を接続する
- [x] 3.1 全キーワードを取得し、保存準備を読み取り専用で作る
  - 取得上限を超えて全キーワードを取得し、展開用の ID マップと採番済み本文を作る。
  - trusted ID を含む適用候補と確認対象を分類するまで永続データを変更しない。
  - 1001件の保存 E2E で末尾のキーワードまで活性化できる準備状態を完了条件とする。
  - _Boundary: SaveGateway, CatalogPagingAdapter_
  - _Depends: 1.2_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 5.7_

- [x] 3.2 (P) 正答の一致と編集経路による現行の衝突判定を characterization する
  - ダイアログ経由、一部正答一致、新規 ID を自動適用し、正答不一致と同一保存内の不整合だけを確認対象にする。
  - 文書内 ID の書き換えを新規キーワードとして扱い、元の ID の履歴と分離する。
  - 衝突計画を扱う6件のユニットテストが成功する状態を完了条件とする。
  - 現行の判定結果に対する証拠であり、共有契約の物理抽出と feature 間依存の解消は5.1〜5.2で行う。
  - _Boundary: KeywordMatchPlanner, SavePlannerAdapter_
  - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.8_

- [x] 3.3 衝突を項目単位で解決して確定内容へ反映する
  - 確認対象だけを表示し、既定を登録済み維持、上書きを明示選択にする。
  - 上書きでは既存行を更新して履歴を継続し、登録済み維持では本文をマスタ内容へ戻し、取消では何も保存しない。
  - editor E2E で自動適用、上書き、登録済み維持、取消の DB 結果を観測できる状態を完了条件とする。
  - これは登録済み／incoming の現行2択に対する baseline 証拠であり、既存行がない異内容 duplicate を含む任意数候補の選択は5.1〜5.2の未完了ギャップとする。
  - _Boundary: ConflictDialogAdapter, EditorPage, SaveGateway_
  - _Depends: 3.1, 3.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 3.4 保存本文とキーワード活性状態を永続化する
  - `(material_id, doc_id)` 一意性、ID 形式、非空正答、owner RLS、章削除時の keyword 保持を DB 制約で固定する。
  - 通常の保存ではキーワード内容、縮約本文、教材内の出現 ID に基づく活性状態を更新し、空本文を許可する。
  - `keywords.chapter_id` は provenance hint として扱い、同じ doc ID の章所属は各章本文の出現から求める。
  - editor E2E で縮約、再展開、非活性化、再活性化、空本文、1001件同期を DB から観測できる状態を完了条件とする。
  - _Boundary: KeywordPersistence, SaveGateway_
  - _Depends: 3.1, 3.3_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 7.2_

- [x] 4. 決定表 05〜09 の現行回帰を固定する
- [x] 4.1 純粋ロジックと共通基盤のユニット回帰を実行する
  - keyword、body、markdown、overwrite の authoring 対象と、当時の依存契約である paged、submitGuard を同じ Vitest 実行へ含める。
  - 87件が成功し、記法、採番、本文変換、衝突分類、全件取得、重複操作ガードの現行挙動を検証する状態を完了条件とする。paged と submitGuard の実装所有を本仕様へ移さない。
  - _Boundary: KeywordSyntax, BodyTransform, MarkdownParser, SavePlannerAdapter, AuthoringIntegrationBaseline_
  - _Depends: 1.1, 1.2, 1.3, 2.4, 3.1, 3.2_
  - _Requirements: 1.3, 1.4, 1.5, 2.2, 2.3, 2.5, 2.6, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.7, 6.1, 6.2, 6.3, 6.6, 6.8, 7.6_

- [x] 4.2 editor UI と通常保存の直列 E2E を実行する
  - ローカル Supabase、`.env.local`、signed-in fixture、管理用クライアント、Chromium、1 worker を実行前提にする。
  - `editor.spec.ts` の27件が成功し、編集、タブ、スクロール、採番、縮約／展開、活性同期、保存失敗、離脱、衝突解決を検証する状態を完了条件とする。
  - _Boundary: EditorPage, BodyEditor, Preview, MarkdownView, KeywordDialog, ConflictDialogAdapter, SaveGateway, KeywordPersistence_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 3.1, 3.3, 3.4_
  - _Requirements: 1.1, 1.2, 1.4, 1.6, 1.7, 1.8, 1.9, 2.1, 2.4, 2.7, 2.8, 4.1, 5.1, 5.3, 5.4, 5.5, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 7.1, 7.2, 7.4, 7.5_

- [x] 4.3 決定表参照と型整合を検証する
  - `spec:coverage` で決定表 05〜09 の61列すべてがテスト参照を持ち、プロジェクト全体289列も欠落しないことを確認する。
  - TypeScript の strict 型検査と production build が成功し、spec／design の公開型に `any` がない状態を完了条件とする。
  - _Boundary: KeywordSyntax, BodyTransform, MarkdownParser, EditorPage, SaveGateway, KeywordPersistence_
  - _Depends: 4.1, 4.2_
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1_

- [ ] 5. authoring 所有の共有契約と lifecycle 統合へ移行する
- [ ] 5.1 正答正規化とキーワード突合 planner を `src/lib` へ集約する
  - `AnswerNormalization` を `src/lib/answer.ts` の authoring 契約として固定し、現行 transfer の match ロジックを `src/lib/keywordMatch.ts` へ移す。
  - `Plan`、安定 conflict／candidate ID と全候補を持つ `Conflict`、候補ID指定の `ConflictResolution`、正答 overlap、同一内容／異内容 duplicate の型と純粋判定を共有 export とし、feature 固有型を持ち込まない。
  - 既存の new、same-ID overwrite、answer conflict、identical duplicate に加え、既存行なし／ありの異内容 duplicate で全候補から1件を選べ、未知・別conflict候補を拒否する fixture が共有契約テストで成功する状態を完了条件とする。
  - _Boundary: AnswerNormalization, KeywordMatchPlanner_
  - _Depends: 3.2_
  - _Requirements: 6.1, 6.2, 6.3, 6.6, 6.8_

- [ ] 5.2 editor adapter を共有突合契約へ切り替えて下流へ引き渡す
  - editor の trusted 編集経路は `SavePlannerAdapter` に限定し、authoring から transfer feature への import をなくす。
  - editor の衝突画面を app-shell の任意数候補ダイアログへ接続し、既存行がない異内容 duplicate でも選択候補から1件だけを本文と保存 payload へ確定できる回帰を追加する。
  - portability と study が各 adapter を再検証するための公開契約を固定する。
  - portability の transfer adapter や study adapter は変更せず、共有契約と editor 統合だけが変更された状態を完了条件とする。
  - _Boundary: SavePlannerAdapter, AuthoringKeywordMatchIntegration_
  - _Depends: 5.1; upstream `app-shell-and-responsive-experience` task 3.9_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [ ] 5.3 (P) catalog の章削除 preview から keyword 出現数を算出する
  - catalog が提供する削除対象 chapter ID／body だけを入力にし、authoring の keyword parser で有効な doc ID トークンを抽出する。
  - 同じ doc ID が複数章または同じ本文に複数回現れる場合も章本文中の各トークンを出現単位として数え、`keywords.chapter_id` は参照しない。
  - authoring 所有の `CatalogDeletionIntegration` が算出結果を app-shell の共通確認 dialog へ渡し、利用者が確認してから catalog の削除確定を呼ぶ。取消時は削除も lifecycle 同期も呼ばない統合テストを追加する。
  - catalog ファイルを変更せず、章 ID ごとの出現数と合計を返す純粋 adapter と実画面 wiring の双方が成功する状態を完了条件とする。
  - _Boundary: KeywordDeletionImpactAdapter, CatalogDeletionIntegration_
  - _Depends: 1.1; upstream `learning-content-catalog` task 4.4_
  - _Requirements: 5.8, 5.10_

- [ ] 5.4 (P) catalog の章削除結果を authoring の活性同期へ接続する
  - catalog が返す削除完了結果と対象教材 ID を受け、catalog 所有 paging で削除後の全章本文を読み取り、残存 doc ID 集合を authoring 所有の活性同期へ渡す。
  - provenance 章が削除されても別章本文に同じ doc ID があれば active を維持し、どの本文にもなければ keyword と履歴を削除せず inactive にする。
  - catalog の削除処理、catalog API、`src/lib/paged.ts` を変更せず、authoring 所有の `CatalogDeletionIntegration` が削除成功時だけ consumer を呼び、取消・失敗時は呼ばれず、同期失敗は再試行可能なエラーになることを統合テストで確認する。
  - authoring が EditorPage／章削除 consumer の本番 wiring と consumer 統合 E2E を所有し、app-shell は共通 dialog／表示状態だけを提供する。active／inactive 両分岐が利用者経路で観測できる状態を完了条件とする。
  - _Boundary: KeywordLifecycleAdapter, CatalogDeletionIntegration_
  - _Depends: 3.4; upstream `learning-content-catalog` tasks 4.4, 5.3_
  - _Requirements: 5.4, 5.5, 5.8, 5.9_

- [ ] 6. 保存失敗の原子性と editor 二重送信を回帰で閉じる
- [ ] 6.1 (P) 原子的な章・キーワード保存 RPC を追加する
  - 認証済み利用者の教材 ID、章 ID、縮約本文、確定キーワード、教材内出現 ID を入力にする `SECURITY INVOKER` RPC を新 migration へ追加する。
  - キーワード upsert、章本文更新、活性同期を同じ PostgreSQL 関数呼び出しのトランザクション境界へ置き、既存の制約と owner RLS を迂回しない。
  - migration 名を `20261010010000_save_chapter_with_keywords.sql` とし、空本文、空キーワード配列、既存 ID 上書きの成功経路をローカル DB で確認できる状態を完了条件とする。失敗時ロールバックの注入検証は6.3が所有する。
  - authenticated owner の成功、cross-owner の読取／更新拒否、anon の実行拒否を検証し、service role は E2E の準備・管理だけに限定され通常利用者経路で使われないことを確認する。
  - _Boundary: AtomicSaveRPC_
  - _Depends: 3.4; upstream `learning-content-catalog` tasks 1.5, 1.6 and `identity-and-access` task 6.7_
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 5.8, 6.4, 6.5, 7.2, 7.3_

- [ ] 6.2 editor の確定 gateway を原子的保存 RPC へ切り替える
  - `prepareSave` と衝突解決は維持し、解決後の縮約本文、確定キーワード、全章から集めた出現 ID を1回の RPC へ渡す。
  - 同じ doc ID が複数章本文にある場合は全出現を membership として保持し、`keywords.chapter_id` は provenance hint に限ることを editor／DB 統合で確認する。
  - 成功時だけ本文、保存済み本文、trusted、キーワード一覧を更新し、失敗時は編集本文と未保存状態を保って再試行可能なエラーを表示する。
  - 既存の3段階書き込みを確定経路から除き、通常保存の既存 E2E 27件が引き続き成功する状態を完了条件とする。
  - _Boundary: SaveGateway_
  - _Depends: 6.1_
  - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.7, 5.8, 6.4, 6.5, 7.2, 7.3_

- [ ] 6.3 保存途中失敗で部分更新が残らない E2E を追加する
  - ローカル Supabase と直列 Playwright を起動し、保存前の章本文、キーワード内容、活性状態を管理用クライアントで記録する。
  - 認証済み Supabase クライアントから有効な新規キーワードと `null` 本文を RPC へ直接渡し、キーワード処理後の章 `NOT NULL` 違反を確実に発生させる。
  - RPC 失敗後に章本文、キーワード内容、活性状態がすべて保存前と同じであり、EditorPage の通信失敗経路では画面に失敗と未保存状態が残ることを確認する。
  - 失敗を解除して再試行すると全変更が一度に反映される状態を完了条件とする。
  - _Boundary: AtomicSaveRPC, SaveGateway, EditorPage_
  - _Depends: 6.1, 6.2_
  - _Requirements: 7.3_

- [ ] 6.4 保存の高速連打が単一確定要求になる E2E を追加する
  - editor の保存 RPC を待機させた状態で保存操作を高速に複数回発生させ、送信要求数を記録する。
  - 待機中は保存操作が無効で、確定要求と DB 更新が1回だけ発生し、完了後に未保存表示が消える状態を完了条件とする。
  - app-shell 所有の submit guard の単体契約ではなく EditorPage adapter への統合を直接回帰する。
  - _Boundary: EditorPage, SubmitGuardAdapter, SaveGateway_
  - _Depends: 6.2_
  - _Requirements: 7.6_

- [ ] 6.5 共有契約抽出と原子的保存への変更後に全品質ゲートを通す
  - Node.js 24、`.env.local`、Docker、ローカル Supabase、Playwright Chromium、1 worker を準備し、新 migration を反映した DB を使う。
  - 型検査、authoring 共有契約、editor adapter、`deletionImpact.test.ts`、`lifecycle.test.ts` のユニット、決定表カバレッジ、editor／章削除 lifecycle E2E、production build を順に実行する。catalog の paging と app-shell の submit guard／dialog は統合経路だけを検証する。
  - すべて成功し、対象5表61/61列の参照、catalog 章削除 preview と active／inactive 両分岐、原子性回帰、単一送信回帰が authoring 所有ゲートとして揃う状態を完了条件とする。portability／study は設計の再検証トリガーに従う各仕様の task で判定する。
  - _Boundary: AuthoringIntegrationValidation_
  - _Depends: 5.2, 5.3, 5.4, 6.3, 6.4_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
