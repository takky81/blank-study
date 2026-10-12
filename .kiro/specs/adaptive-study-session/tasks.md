# 実装計画

## Baseline Evidence

- study 純粋ポリシー: `src/features/study/order.ts`、`question.ts`、`range.ts`、`score.ts`、`alt.ts`、`srs.ts` と各隣接 unit test
- session／data 境界: `src/features/study/StudyPage.tsx`、`api.ts`
- 上流契約: authoring 所有の `src/lib/answer.ts`／`keywordMatch.ts`／`keyword.ts`／`markdown.ts`、catalog 所有の `src/lib/paged.ts`／章整合性、app-shell 所有の `src/components/MarkdownView.tsx`
- 永続化: `supabase/migrations/20260829000000_init.sql` の `keywords`、`keyword_stats`、`answer_logs`、索引、外部キー、owner RLS
- 回帰資産: `spec/tables/12-order.jsonl` 16列、`13-answer-format.jsonl` 11列、`14-choice.jsonl` 15列、`15-display.jsonl` 17列、`16-judge.jsonl` 19列、`17-alt-answer.jsonl` 9列、`18-srs.jsonl` 16列、`e2e/study.spec.ts`
- 実行確認: 関連 unit 8ファイル111件、study E2E 29件、型検査、決定表カバレッジ289/289列、production build がすべて成功（2026-10-10、build は既存の chunk size 警告のみ）。
- E2E 前提: Node.js 24、`.env.local`、Docker、ローカル Supabase DB／Auth／REST、Playwright Chromium、`globalSetup`、`workers: 1`、`fullyParallel: false`。
- 未完了ギャップ: 科目配下の教材／章全件取得、解答記録の原子性、同一セッション内の最新 SRS 状態、別解登録の全段階原子性。以下では直接実装・テスト証拠がある仕事だけを `[x]` とする。

- [x] 1. 学習の純粋ポリシーを固定する
- [x] 1.1 (P) [1h] 自動順・出現順と直近回避を実装・検証する
  - 未出題優先、期限昇順、期限前の前倒し、同着乱数、本文位置順、直近10件回避、10／9件境界、全候補回避時の緩和を1つの純粋な選択契約に閉じる。
  - 出題順の15件の unit test が成功し、候補0件では終了を示す値を返す状態を完了条件とする。
  - _Boundary: QuestionSelector_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 1.2 [1h] authoring の正規化と完全一致を study 判定へ適用する
  - authoring 所有の共有契約を使い、空入力、読みの違い、部分一致を正解にせず、固定の「わからない」だけを study 固有の常に不正解な操作とする。
  - 共有 answer の12件と study adapter の unit test が成功し、study 内に別の正規化実装がない状態を完了条件とする。
  - _Boundary: StudyJudgmentAdapter_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 1.3 [1h] 習熟度による形式と関連語の選択肢を実装・検証する
  - 3回／90%の境界、明示形式、誤答0件の記述 fallback、登録済み誤答優先、共通タグ、章距離、非活性／自身／正答／重複除外を純粋規則に閉じる。
  - 正答1件と最大3件の誤答を無作為順で返し、固定の「わからない」を常に不正解にする24件の unit test が成功する状態を完了条件とする。
  - _Boundary: FormatAndChoicePolicy, StudyKeywordMatchAdapter_
  - _Depends: 1.2_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

- [x] 1.4 (P) [1h] 表示範囲、伏せ字、および判定後の色分けを実装・検証する
  - 章から教材全体までの1段ずつの拡張、同じ ID の全空欄、共通タグの伏せ字、正答復元、誤答語の不正解色表示を表示状態だけから決定する。
  - 表示範囲の15件の unit test と Markdown 表の既存 parser test が成功する状態を完了条件とする。
  - _Boundary: StudyPresentationPolicy_
  - _Depends: 1.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10_

- [x] 1.5 (P) [1h] 今回を含む問題別成績を算出・検証する
  - 既存の累積数または未出題状態へ今回の正誤を加え、正答数、出題数、正答率を副作用なく返す。
  - score の3件の unit test が成功し、初回と既出題の双方で今回を含む値を返す状態を完了条件とする。
  - _Boundary: ScoreProjection_
  - _Requirements: 6.7_

- [x] 1.6 (P) [1h] 別解の導線と重複なし追加を実装・検証する
  - 不正解の記述入力だけを登録対象にし、trim 後の値を末尾へ追加し、正規化後に既存正答と一致する入力を増やさない。
  - alternative の7件の unit test が成功し、正解、選択肢、空入力では導線を出さない状態を完了条件とする。
  - _Boundary: AlternativeAnswerPolicy, StudyKeywordMatchAdapter_
  - _Depends: 1.2_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.10_

- [x] 1.7 (P) [1h] SM-2相当の間隔、易しさ係数、期限を実装・検証する
  - 初期2.5、下限1.3、品質5／0、1日／6日／更新前EF倍、0.5切上げ、現在時刻基準、誤答リセットを純粋計算に閉じる。
  - SRS の15件の unit test が成功し、範囲拡張が結果へ影響せず、別解時は正解として計算できる状態を完了条件とする。
  - _Boundary: SrsPolicy_
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

- [x] 2. read model、永続化、セッション画面を接続する
- [x] 2.1 [2h] 学習範囲の read model と候補射影を統合する
  - 科目／教材を入口に、所有者が見られる教材、章、活性キーワード、学習状態をアプリ型へ変換する。
  - 保存済み章順と本文内 ID 順を使い、`chapter_id` ではなく選択章本文の出現、活性状態、重複除外を反映した対象数と未出題数が設定画面へ出る状態を完了条件とする。
  - キーワード1,001件を全件取得する E2E を既存証拠とし、教材／章全件取得の不足は4へ分離する。
  - _Boundary: StudyDataGateway, CandidateProjection_
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9_

- [x] 2.2 [2h] 解答成功時に履歴、累積数、SRSを保存する
  - 認証利用者のキーワードへ形式、入力、正誤、拡張、時刻を記録し、累積数と SRS 状態を更新する。
  - 成功時に問題別成績を表示でき、記録中の二重操作を抑止し、中断時に進行中の promise を待つ状態を完了条件とする。
  - 成功経路と失敗時の警告／継続を示す E2E、および migration 制約を既存証拠とし、複数書込みの原子性は5へ分離する。
  - _Boundary: AnswerRecordingGateway_
  - _Depends: 1.5, 1.7, 2.1_
  - _Requirements: 6.5, 6.7, 7.1, 7.2, 7.3, 7.4, 9.8_

- [x] 2.3 [2h] 別解成功時に正答、直前履歴、SRSを訂正する
  - 登録した別解を正答一覧へ追加し、直前の当該キーワード履歴だけを正解へ変更し、登録前状態から正解として SRS を計算する。
  - 画面の判定と一周状態を正解へ変え、再訪後も登録済み別解で正解になる E2E が成功する状態を完了条件とする。
  - 最初の更新失敗の E2E を既存証拠とし、後段失敗の原子性は7へ分離する。
  - _Boundary: AlternativeRegistration_
  - _Depends: 1.6, 1.7, 2.2_
  - _Requirements: 8.5, 8.6, 8.7, 8.8, 9.9_

- [x] 2.4 [3h] 出題設定から終了／中断までの状態機械を統合する
  - setup、answering、judged、done を遷移し、正解だけを一周から外し、不正解を再出題候補へ残す。
  - 正誤、形式、全正答、不正解入力、成功時成績、進捗、終了時の正答数／解答数／所要時間を観測できる状態を完了条件とする。
  - 中断後もそこまでの履歴が残り、記録失敗後も判定を見て継続できる E2E を既存証拠とする。
  - _Boundary: StudySessionPage_
  - _Depends: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3_
  - _Requirements: 2.7, 2.8, 2.9, 2.10, 6.5, 6.6, 6.7, 6.8, 7.4, 7.5, 10.5_

- [x] 2.5 [2h] study 固有の章選択とレスポンシブ解答 UI を統合する
  - 初期閉状態の章 tree、個別／一括の開閉と選択、狭幅の固定開始カード、縦 resize 可能な本文領域を提供する。
  - 問題と判定結果の初期表示で現在空欄が本文中央にあり、解答操作が下部ナビに隠れない E2E が成功する状態を完了条件とする。
  - _Boundary: StudySessionPage_
  - _Depends: 2.1, 2.4_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 3. 決定表 12〜18 の現行回帰を固定する
- [x] 3.1 [1h] 純粋ロジックと共有契約の unit 回帰を実行する
  - study の6ポリシー、共有 answer、共有 Markdown の8ファイルを同じ Vitest 実行へ含める。
  - 111件が成功し、順序、形式、選択肢、表示、判定、成績、別解、SRS、Markdown 表を検証する状態を完了条件とする。
  - _Boundary: QuestionSelector, FormatAndChoicePolicy, StudyPresentationPolicy, StudyJudgmentAdapter, ScoreProjection, AlternativeAnswerPolicy, SrsPolicy_
  - _Depends: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.7, 8.1, 8.2, 8.3, 8.4, 8.10, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9_

- [x] 3.2 [2h] study の利用者経路と DB 副作用を直列 E2E で実行する
  - ローカル Supabase、signed-in fixture、管理用クライアント、Chromium、1 worker を使う。
  - `study.spec.ts` の29件が成功し、setup、responsive、範囲、形式、表示、判定、記録、別解、終了、中断、1,001キーワード、章変更連携を検証する状態を完了条件とする。
  - _Boundary: StudySessionPage, StudyDataGateway, AnswerRecordingGateway, AlternativeRegistration_
  - _Depends: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Requirements: 1.3, 1.6, 1.7, 2.7, 2.8, 2.9, 2.10, 3.3, 3.4, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.9, 5.10, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.5, 8.1, 8.2, 8.5, 8.7, 8.8, 9.5, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 3.3 [1h] 型、決定表参照、および production build を検証する
  - strict 型検査、決定表カバレッジ、production build を現在のコード状態で実行する。
  - 型検査が成功し、全体289/289列がテスト参照を持ち、build が既存の chunk size 警告以外で成功する状態を完了条件とする。
  - _Boundary: StudySessionPage, StudyDataGateway, AnswerRecordingGateway, AlternativeRegistration_
  - _Depends: 3.1, 3.2_
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1_

- [ ] 4. 学習範囲の全行を欠落なく取得する
- [ ] 4.1 [2h] authoring 所有の照合契約へ study adapter を統一する
  - 選択肢の正答除外と別解の重複除外が `src/lib/answer.ts` と `src/lib/keywordMatch.ts` の正規化、overlap、duplicate を呼び出すようにする。
  - study は固定「わからない」と別解登録の状態遷移だけを所有し、共有型や照合ロジックを再定義しない。
  - authoring の共有 fixture と study の選択肢／別解 adapter 回帰が同時に成功する状態を完了条件とする。
  - _Boundary: StudyKeywordMatchAdapter, StudyJudgmentAdapter, AlternativeAnswerPolicy_
  - 外部 prerequisite: `markdown-keyword-authoring` Tasks 5.1, 5.2。
  - _Requirements: 4.3, 6.1, 6.2, 6.3, 6.4, 8.4, 8.10_

- [ ] 4.2 [2h] 教材と章の問い合わせを catalog 所有の共通ページングへ統合する
  - 科目範囲の教材と、対象教材群の章を安定した一意順で全ページ取得し、既存の read model 形状を変えない。
  - catalog の owner／material／parent 整合性を前提に、教材／章／章本文／キーワードのどれが1回の取得上限を超えても候補射影へ全行が渡り、`src/lib/paged.ts` 自体を変更しない状態を完了条件とする。
  - _Boundary: StudyDataGateway, CatalogPagingConsumer_
  - 外部 prerequisite: `learning-content-catalog` Tasks 1.5, 1.6, 5.1, 5.2, 5.3。
  - _Requirements: 1.1, 1.2, 1.8_

- [ ] 4.3 [3h] 複数章へ分散した1,001件超の候補と provenance を E2E で固定する
  - 1章1,001キーワードだけでなく、取得上限を超える章へキーワードを分散して科目範囲と教材範囲を開く。
  - provenance `chapter_id` が別章または null でも、選択章本文に doc ID が出現する active keyword を候補にし、provenance 章削除後も別章出現が残れば候補のままとなることを検証する。
  - 設定画面の対象数が全件と一致し、取得末尾の章にある問題も開始後に候補となる状態を完了条件とする。
  - _Boundary: StudyDataGateway, CandidateProjection, StudySessionPage_
  - _Depends: 4.2_
  - _Requirements: 1.1, 1.2, 1.4, 1.8, 1.9_

- [ ] 5. 解答記録を原子的にする
- [ ] 5.1 [3h] 解答履歴と学習状態を1トランザクションで更新する
  - 認証利用者、キーワード、解答 payload、現在時刻を入力にし、DB 内で現在状態を読み、履歴1件と学習状態を同じ DB transaction で更新する。
  - 所有者検証と、SRS 計算に必要な現状態の一貫読取り、および別解訂正に使う解答前の累積数／SRS snapshot 5列を `answer_logs` へ保存する処理を新しい migration へ定義する。
  - `20261010030000_record_study_answer.sql` に `SECURITY INVOKER`、空の `search_path`、schema 修飾、および anon の実行権限剥奪を定義し、他 spec の migration timestamp を再利用しない。
  - 履歴または学習状態の一方だけが残らず、成功時は双方が今回を1回だけ反映する状態を完了条件とする。
  - _Boundary: AnswerRecordingTransaction_
  - _Depends: 1.7, 2.2; upstream `learning-content-catalog` tasks 1.5, 1.6 and `identity-and-access` task 6.7_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 5.2 [2h] 記録 gateway を原子的 RPC へ切り替える
  - 履歴と学習状態を1回の RPC で更新し、成功または失敗を呼出側へ返す。
  - 成功時は保存済みの累積数と SRS 全状態を返し、失敗時は警告、判定継続、成績非表示、および以前に成功した記録を保持する既存 UI 契約を維持する。
  - _Boundary: AnswerRecordingGateway_
  - _Depends: 5.1_
  - _Requirements: 6.8, 7.1, 7.2, 7.3, 7.5, 7.6_

- [ ] 5.3 [3h] 履歴／学習状態の途中失敗を DB と E2E で回帰する
  - `supabase/tests/database/adaptive_study_session.test.sql` の rollback 前提 transaction 内で、`keyword_stats` へ一時的な例外 trigger を設置して履歴 insert 後の更新を失敗させ、要求内の履歴と学習状態が両方不変であることを確認する。
  - E2E では RPC 失敗時に以前に成功した記録を保持し、判定と警告が残り、問題別成績を表示せず次へ進める状態を完了条件とする。
  - identity 所有の `RpcSecurityMatrix` harness を study 所有の RPC ケースから呼び出し、authenticated owner 成功、cross-owner の返却値／副作用分離、anon の本体到達前拒否、service role の seed／事後確認限定を確認する。identity の公開 RPC 列挙テスト自体は変更せず、本 RPC のケース登録だけを完了条件とする。
  - _Boundary: AnswerRecordingTransaction, AnswerRecordingGateway, StudySessionPage_
  - _Depends: 5.1, 5.2_
  - _Requirements: 6.7, 6.8, 7.1, 7.2, 7.3, 7.5_

- [ ] 6. 同一セッションの最新 SRS 状態を引き継ぐ
- [ ] 6.1 [2h] 記録結果の SRS 全状態を次の解答へ引き継ぐ
  - 記録成功の返却値から累積数、反復回数、間隔、易しさ係数、期限を read model へまとめて反映する。
  - 1問へ不正解後すぐ正解する経路で、2回目が DB に保存済みのリセット後状態を基準に計算され、再読込後の値と一致する E2E を完了条件とする。
  - _Boundary: StudySessionPage_
  - _Depends: 5.2_
  - _Requirements: 2.8, 7.6, 9.5, 9.6, 9.7_

- [ ] 7. 別解登録を全段階で原子的にする
- [ ] 7.1 [3h] 正答、直前履歴、学習状態を1トランザクションで訂正する
  - 認証利用者の対象キーワードと直前の該当解答を transaction 内で行ロックし、解答履歴に保存された誤答前 snapshot を読んで、別解追加、直前履歴の正解化、正解 SRS 更新を一括実行する。
  - 最新履歴の不正解、現在件数と誤答前件数の関係、snapshot の全 null／全非 null を検証し、`SECURITY INVOKER`、空の `search_path`、schema 修飾、anon の実行権限剥奪を適用する。
  - 以前の履歴を変更せず、途中失敗時は3対象すべてが登録前の状態に戻る RPC を `20261010040000_register_study_alternative.sql` へ追加する。
  - _Boundary: AlternativeRegistrationTransaction_
  - _Depends: 1.6, 1.7, 2.3, 5.1; upstream `learning-content-catalog` tasks 1.5, 1.6 and `identity-and-access` task 6.7_
  - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.9, 9.9_

- [ ] 7.2 [2h] 別解 gateway を原子的登録契約へ切り替える
  - 既存の導線、trim、重複排除を維持し、確定済み answers を1回の登録要求へ渡す。学習状態は RPC が DB 内の直前履歴 snapshot と現在状態から確定する。
  - 成功時だけ判定、正解数、solved、画面内 answers を更新し、失敗時は既存 state を一切変更しない状態を完了条件とする。
  - _Boundary: AlternativeRegistration_
  - _Depends: 5.2, 7.1_
  - _Requirements: 8.5, 8.6, 8.7, 8.8, 8.9, 9.9_

- [ ] 7.3 [3h] 別解登録の各段階失敗を統合回帰する
  - `supabase/tests/database/adaptive_study_session.test.sql` の rollback 前提 transaction 内で、`answer_logs` と `keyword_stats` へ段階別の一時例外 trigger を設置し、正答更新後／直前履歴更新後に RPC を失敗させ、全対象が登録前のままであることを DB から確認する。
  - 成功経路、登録せず次へ進む経路、登録後の次回判定が既存どおりで、失敗時は判定が不正解のまま警告を表示する状態を完了条件とする。
  - identity 所有の `RpcSecurityMatrix` harness を study 所有の RPC ケースから呼び出し、authenticated owner 成功、cross-owner の返却値／副作用分離、anon の本体到達前拒否、service role の seed／事後確認限定を確認する。identity の公開 RPC 列挙テスト自体は変更しない。
  - _Boundary: AlternativeRegistrationTransaction, AlternativeRegistration, StudySessionPage_
  - _Depends: 7.1, 7.2_
  - _Requirements: 8.5, 8.6, 8.7, 8.8, 8.9, 9.9_

- [ ] 8. ギャップ解消後の品質ゲートを実行する
- [ ] 8.1 [2h] 全品質ゲートを実行する
  - Node.js 24、ローカル Supabase、Chromium、1 worker を使い、型検査、authoring 共有契約と study adapter の unit、決定表カバレッジ、study E2E、study 所有 RPC の `RpcSecurityMatrix` 4主体ケース、production build を順に実行する。
  - 既存29件に共有照合 adapter、ページング／provenance、記録原子性、連続 SRS、別解後段失敗の回帰が加わり、全コマンドが成功する状態を完了条件とする。identity 所有の列挙テスト自体の変更は本タスクに含めない。
  - _Boundary: StudySessionPage, StudyDataGateway, AnswerRecordingGateway, AnswerRecordingTransaction, AlternativeRegistration, AlternativeRegistrationTransaction_
  - _Depends: 4.1, 4.3, 5.3, 6.1, 7.3_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.1, 10.2, 10.3, 10.4, 10.5_
