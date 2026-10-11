# 実装計画

- [x] 1. 構造化設問の専用成績基盤を構築する
- [x] 1.1 専用統計・解答履歴のスキーマを追加する
  - 設問ごとの出題数、正解数、連続正解、間隔、容易度、復習期限と、不変の解答eventを穴埋め用テーブルから分離して保持する。
  - question・ownerの複合参照、非負件数、正解数上限、SRS値、形式の制約と、期限・履歴読取用indexを追加する。
  - 設問削除では専用成績も削除され、穴埋め履歴・統計との参照やunionが存在しない状態を確認できる。
  - _Boundary: QuestionStudyPersistence_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 8.1, 8.2_

- [x] 1.2 回答記録を単一トランザクションへまとめる
  - 設問のowner、有効状態、期待版を検査し、保存済み模範解答から正誤と次のSRSを導出する原子的記録RPCを追加する。
  - 成功時だけ履歴1件と最新statsを返し、履歴追加またはstats更新の途中失敗では両方を不変にする。
  - 同じセッションで再評価する場合も直前に確定したstatsから次状態を計算し、stale版は内容を漏らさない競合結果になる。
  - _Boundary: RecordQuestionAnswerRPC_
  - _Requirements: 5.1, 5.2, 5.3, 5.6, 6.1, 6.2, 6.5, 6.6_

- [x] 1.3 専用データへRLSとRPC権限を適用する
  - stats/logsのowner policy、authenticated限定grant、RPCのinvoker権限、空search path、schema修飾、anon revokeを追加する。
  - 通常読取とRPCが同じowner境界を通り、ブラウザがservice roleを必要としない権限定義にする。
  - owner以外は設問・履歴・statsの存在や値を判別できない状態を確認できる。
  - _Boundary: QuestionStudyPersistence_
  - _Requirements: 1.7, 8.1, 8.2, 8.8_

- [x] 2. 候補・形式・セッションの純粋ポリシーを実装する
- [x] 2.1 (P) 階層範囲から重複なし候補を射影する
  - 科目、教材、章、keywordの範囲を認可済み階層と章本文出現へ解決し、有効な設問だけを候補にする。
  - 同じkeywordが複数章に出てもquestion IDで重複排除し、代表位置を全出現の最小`(subjectOrder, materialOrder, chapterOrder, bodyOccurrenceIndex)`に固定する。keyword直接scopeはquestion `(sortOrder,id)`だけで一意順を作る。
  - 空、存在しない範囲、権限外を区別しすぎず、画面が安全な空状態または戻り先を選べる結果を返す。
  - _Boundary: QuestionCandidateProjection_
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.7_

- [x] 2.2 (P) 設問形式と完全一致判定のadapterを実装する
  - 選択、記述、自動の要求を既存形式規則へ渡し、専用statsなしは選択式、選択肢不足は記述式に解決する。
  - 模範解答1件、重複しない登録選択肢、固定の「わからない」を区別した回答候補として組み立てる。
  - 記述回答は空を拒否し、共通正答正規化による模範解答との完全一致だけで判定する。
  - _Boundary: QuestionFormatAndJudgmentAdapter_
  - _Depends: 1.1_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.7_

- [x] 2.3 (P) 次問選定とセッション集計を実装する
  - 自動順は未出題・期限・専用習熟状態、出現順は候補の安定順を利用し、直近の連続出題を避ける。
  - 回答確定ごとに回答済み・正解件数を更新し、全候補完了と途中終了を判定する。
  - 同じ入力と確定statsから再現可能な次問とsession結果を返す。
  - _Boundary: QuestionSessionPolicy_
  - _Depends: 1.1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 3. question-studyデータアクセスを実装する
- [x] 3.1 階層・設問・専用統計を欠落なく読み取る
  - catalogとquestion-bankの公開契約を利用し、DB行をcamelCaseのcandidate・stats型へ変換する。
  - 階層、設問、statsを安定一意順序で全ページ取得し、1,001件以上でも欠落・重複なく候補射影へ渡す。
  - 読取失敗は操作文脈付き日本語Errorとなり、権限外データは内容を漏らさない。
  - _Boundary: QuestionStudyApi, QuestionCandidateReadAdapter_
  - _Depends: 2.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7, 5.7, 8.1, 8.2, 8.3, 8.7_

- [x] 3.2 回答記録gatewayと判別可能な結果を実装する
  - 回答、形式、期待設問版を記録RPCへ渡し、recorded／question-conflict／failedを型安全に変換する。
  - 成功時だけ確定log IDと最新statsを返し、失敗時に未確定statsを返さない。
  - RPC再取得後の履歴件数、統計、SRSが1回答分だけ一致する。
  - _Boundary: QuestionStudyApi, RecordQuestionAnswerAdapter_
  - _Depends: 1.2, 1.3, 2.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.6, 6.1, 6.2, 6.5, 6.6, 8.1, 8.2_

- [x] 4. 構造化設問の学習UIを構築する
- [x] 4.1 setupと解答セッション画面を実装する
  - 階層範囲、順序、形式を選び、loading、empty、answering、judged、done、errorを区別して表示する。
  - 選択式と記述式をラベル付きで操作でき、空回答を確定せず、記録中は同じ回答の再送信を抑止する。
  - 狭幅でも横スクロールなしに設問、回答、進行状況、終了操作へ到達できる。
  - _Boundary: StructuredQuestionStudyPage_
  - _Depends: 2.2, 2.3, 3.1, 3.2_
  - _Requirements: 1.6, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.6, 3.7, 4.2, 4.6, 6.4, 8.4, 8.5, 8.6, 8.7_

- [x] 4.2 結果・解説・見直しフラグ画面を実装する
  - 設問文、利用者回答、正誤、模範解答、任意解説、次問／終了操作を判定後に表示する。
  - 設問バンクのversion付きflag契約で疑義と解説追加を独立または同時に設定し、既存解説があっても追加flagを許可する。
  - flag失敗では判定結果を保持して確定前表示へ戻し、競合では自動上書きせず再読込を促す。
  - _Boundary: QuestionResultPanel_
  - _Depends: 4.1_
  - _Requirements: 4.4, 4.5, 4.6, 7.1, 7.2, 7.3, 7.4, 7.5, 8.5_

- [x] 4.3 記録失敗の保持と明示再試行を統合する
  - 記録失敗時も設問version、回答、判定、結果表示を保持し、未記録警告と再試行を提示する。
  - 再試行成功時だけ次問へ進み、履歴1件・stats1回答分を画面へ反映する。
  - conflictでは現在設問を再読込し、古い結果を記録せず再回答可能な状態へ戻る。
  - _Boundary: StructuredQuestionStudyPage, RecordQuestionAnswerIntegration_
  - _Depends: 4.1, 4.2_
  - _Requirements: 5.6, 6.3, 6.4, 6.5, 6.6_

- [x] 5. アプリ経路と下流統計契約へ接続する
- [x] 5.1 構造化設問学習のroute adapterをapp-shellへ引き渡す
  - feature-local `QuestionStudyRoute.tsx`を実装し、`questions.study`、`/question-study`、`nav.questions.study`、`設問学習`、`wide,narrow`とscope pair・許可済み`returnTo`を提供する。
  - `src/App.tsx`、feature route registry、共通navigationは変更せず、最終登録とwide／narrow導線の合成を`app-shell-and-responsive-experience` task 6.2へ引き渡す。
  - 直接表示・search付き再読込、各scope開始、正常終了の復帰、scope片側欠落・未知scope・不正UUID・許可外`returnTo`の記録なしerrorと`/questions`復帰をadapter contract testへ追加する。
  - URL直開きでもowner確認を通り、権限外の設問や成績を表示しない。
  - _Boundary: QuestionStudyRouteAdapter_
  - _Depends: 4.3; upstream `app-shell-and-responsive-experience` task 6.1 descriptor contract_
  - _Requirements: 1.7, 8.1, 8.2, 8.4, 8.8, 8.10, 8.11, 8.12_

- [x] 5.2 下流向け専用統計read contractを固定する
  - question別統計に加え、keyword単位で有効設問だけを集計し、`attempts=sum(asked_count)`、`correct=sum(correct_count)`、`wrong=attempts-correct`、`accuracy=correct/attempts`、`questionCount=active questions`を型付きで公開する。
  - 無効／削除済み設問を除外し、statsなしは各件数0、attempts 0はaccuracy nullの未出題として返す。穴埋め統計を混ぜず、exchangeが抽出条件へ利用できる。
  - 下流consumerが専用テーブルへ書き込まず必要統計を取得できることを統合テストで確認する。
  - _Boundary: QuestionStudyStatsReadContract_
  - _Depends: 3.1, 3.2_
  - _Requirements: 5.2, 5.4, 5.5, 5.7, 5.8, 5.9, 8.1, 8.3_

- [ ] 6. 回帰と品質ゲートを完成する
- [x] 6.1 (P) 候補・形式・セッションの単体回帰を追加する
  - 4階層範囲、同一keywordの複数章出現における最小tuple代表位置、keyword直接scopeの設問順、重複排除、安定順、空候補を境界値込みで検証する。
  - 3形式、statsなし、選択肢不足、わからない、空記述、完全一致、自動順、出現順、直近回避、終了を検証する。
  - 対象unit testが上流の正答・形式・SRS契約変更を検出してすべて成功する。
  - _Boundary: QuestionStudyPolicyTests_
  - _Depends: 2.1, 2.2, 2.3_
  - _Requirements: 1.1, 1.3, 1.5, 1.6, 2.1, 2.2, 2.3, 2.5, 2.7, 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.7_

- [ ] 6.2 DB原子性と穴埋め分離の統合テストを追加する
  - 正解／不正解の履歴・stats・SRS、同一セッションの最新state、stale version拒否をローカルDBで検証する。
  - DB test transactionの一時triggerで履歴追加後とstats更新中に失敗を注入し、部分成功が残らないことを確認する。
  - question回答の前後で穴埋め用履歴・statsが不変であり、対象DBテストが直列実行で成功する。
  - _Boundary: QuestionStudyDatabaseConformance_
  - _Depends: 1.2, 3.2_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.5, 6.6_

- [ ] 6.3 (P) 新規RPCの4主体セキュリティ適合テストを追加する
  - DB catalogから公開user-data RPCを自動列挙し、`record_structured_question_answer`を含む全件がRpcSecurityMatrix fixtureに過不足なく存在することを検証する。
  - owner成功、cross-owner拒否、anon拒否、service roleはfixture準備・事後確認限定とする。
  - 通常読取とRPCが他利用者の設問・履歴・statsを漏らさず、grantがauthenticatedだけに限定されることを検証する。
  - 4主体の権限回帰が直列実行で成功する。
  - _Boundary: QuestionStudyRpcSecurityConformance_
  - _Depends: 1.3, 3.2_
  - _Requirements: 1.7, 8.1, 8.2, 8.8, 8.9_

- [ ] 6.4 (P) 1,001件超の候補・統計適合テストを追加する
  - 1範囲に1,001件以上の設問とstatsを用意し、全件・安定順・question ID重複なしを検証する。
  - ページ境界で同じorderやdue日時が続いてもID tie-breakerで欠落しないことを確認する。
  - 同一keywordの複数章出現で最小tupleを代表位置にし、keyword直接scopeでは`(sortOrder,id)`のみを使う。keyword集計のsum／差分／比率／active count、statsなし、attempts 0、無効・削除除外も確認する。
  - 科目、教材、章、keywordのvolume経路が成功する。
  - _Boundary: QuestionStudyVolumeConformance_
  - _Depends: 3.1, 5.2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.7, 5.7, 5.8, 5.9, 8.3_

- [ ] 6.5 構造化設問学習の主要利用者経路をE2E検証する
  - 範囲選択、3形式、正解／不正解／わからない、解説、次問、完了／途中終了と専用成績を検証する。
  - 記録失敗、明示再試行、二重送信抑止、version conflict、empty／error／retryを検証する。
  - 疑義／解説追加flagの独立・同時設定と、穴埋め成績不変を認証済みroute上で確認する。
  - _Boundary: StructuredQuestionStudyFunctionalE2E_
  - _Depends: 5.1, 5.2, 6.2, 6.3_
  - _Requirements: 1.6, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 4.4, 4.5, 4.6, 5.1, 5.4, 5.5, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.5, 8.6, 8.7_

- [ ] 6.6 (P) レスポンシブとアクセシビリティのUI回帰を追加する
  - 広幅／狭幅で横スクロールなしに設問、回答、結果、flag、次の操作へ到達できることを検証する。
  - キーボード操作、label、正誤・errorのlive通知、loadingとemptyの区別を検証する。
  - ライト／ダークの既存tokenを維持して対象UI回帰が成功する。
  - _Boundary: StructuredQuestionStudyUiConformance_
  - _Depends: 5.1_
  - _Requirements: 8.4, 8.5, 8.6, 8.7_

- [ ] 6.7 最終品質ゲートを実行する
  - 型検査、unit test、決定表カバレッジ、production build、DB適合テスト、対象E2Eを実行する。
  - 失敗をquestion-study境界内で修正し、設問バンクと既存穴埋め学習の回帰を増やさない。
  - すべての必須品質コマンドが成功した状態を完了とする。
  - _Boundary: StructuredQuestionStudyIntegration_
  - _Depends: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - _Requirements: 1.7, 4.7, 5.4, 6.2, 7.4, 8.1, 8.3, 8.4, 8.5_
