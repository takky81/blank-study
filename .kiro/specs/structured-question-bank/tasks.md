# 実装計画

- [ ] 1. 設問永続化と権限境界を構築する
- [x] 1.1 設問マスタのスキーマと参照整合性を追加する
  - 予約済みmigrationの後ろに一意な追加migrationを作り、設問内容、選択肢、順序、状態、フラグ、版、監査時刻を保持する。
  - keyword・material・ownerの複合参照、必須文字列、非負順序、版、JSON選択肢の制約と、一覧・flag抽出用indexを追加する。
  - keyword削除時は設問が削除され、章削除でkeywordが残る場合は設問が保持されることをDBで確認できる。
  - _Boundary: QuestionPersistence_
  - _Requirements: 1.2, 1.3, 1.4, 2.2, 2.3, 2.6, 3.3, 3.4, 3.5, 5.1, 5.2, 6.2, 6.3, 6.5, 6.6_

- [x] 1.2 期待版付き単一設問変更を原子的にする
  - `private.apply_structured_question_content(p_question_id uuid, p_keyword_id uuid, p_expected_version bigint, p_content jsonb, p_flag_patch jsonb)`を`SECURITY INVOKER`、空search path、完全修飾名で作り、primitive自身が`auth.uid()` owner、keyword/question整合性、期待版、内容、単一version increment、未指定flag保持を再検証する。作成、内容更新、flag更新、有効状態、削除の単一公開command RPCから利用する。
  - stale版では内容を変えず現在版を返し、同じ期待版の二重更新は片方だけ成功する。
  - _Boundary: QuestionMutationRPC_
  - 通常編集とexchange一括取込が共有できるconformance fixtureで、同じdraftに同じ検証・版・flag結果を返すことを確認する。
  - _Requirements: 2.1, 2.7, 3.2, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 7.3_

- [x] 1.3 キーワード内の並べ替えを原子的にする
  - keyword内のordered IDと各期待版を検査し、対象外ID、重複ID、stale版を拒否する。
  - 全行が一致した場合だけ安定順を0から保存し、対象行の版と更新時刻を進める。
  - 途中エラーまたは競合では全行不変となることをDB結果で確認できる。
  - _Boundary: QuestionReorderRPC_
  - _Requirements: 3.3, 5.3, 5.4, 5.6_

- [x] 1.4 RLSとRPC grantを設問永続化へ適用する
  - ownerの`USING`／`WITH CHECK`、公開RPCのauthenticated限定grant、invoker権限、空のsearch pathを適用する。
  - `private` schemaをSupabase/PostgREST exposed schemasから除外し、authenticatedにはschema `USAGE`と`EXECUTE ON FUNCTION private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)`だけを付与し、`PUBLIC`／`anon`からrevokeする。
  - 通常Data APIとRPCが同じowner境界を通り、他利用者の設問やkeywordを参照・変更できない構成にする。
  - authenticated以外に公開RPCの実行権がなく、ブラウザがservice roleを必要としないことを権限定義から確認できる。
  - _Boundary: QuestionPersistence_
  - _Requirements: 1.5, 6.1, 6.2, 6.3, 6.4, 6.7, 6.9, 6.10_

- [ ] 2. 設問ドメインとデータアクセスを実装する
- [x] 2.1 (P) 公開設問型と入力検証を実装する
  - 安定ID、版token、設問内容、状態、フラグを`any`なしの型で表現する。
  - 必須値のtrim、空選択肢、正規化後の重複、模範解答との重複、任意解説を純粋関数で検証する。
  - 有効な入力では選択肢順を維持したdraftを返し、無効な入力ではfieldごとの理由が得られる。
  - _Boundary: QuestionContentPolicy, StructuredQuestionReadContract_
  - _Depends: 1.1_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.1, 5.2_

- [x] 2.2 (P) キーワード・教材単位の欠落しない読取を実装する
  - DB行をcamelCaseの公開設問型へ変換し、認可済み行だけを返す。
  - keyword一覧を`(sort_order, id)`、教材一覧を`(keyword_id, sort_order, id)`の安定一意順序で共通ページングする。
  - 1,001件以上でも欠落・重複なく返り、存在しない／権限外のkeywordは内容を漏らさない結果となる。
  - _Boundary: StructuredQuestionApi, StructuredQuestionReadContract_
  - _Depends: 1.1_
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.1, 7.1, 7.2_

- [x] 2.3 設問mutation gatewayと競合結果を実装する
  - 保存、flag、有効状態、並べ替え、削除を設問RPCへ接続し、DB結果をsaved／version-conflictの判別可能な型へ変換する。
  - 通信・DB失敗を操作文脈付き日本語Errorへ変換し、競合では現在版を保持する。
  - 各操作を再取得すると確定内容・順序・flag・版が一致する。
  - _Boundary: StructuredQuestionApi, QuestionMutationRPCAdapter_
  - _Depends: 1.2, 1.3, 2.1_
  - _Requirements: 2.7, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 5.3, 5.4, 5.5, 5.6_

- [ ] 3. 設問管理UIを構築する
- [x] 3.1 (P) 設問作成・編集フォームを実装する
  - 設問文、模範解答、順序付き選択肢、任意解説をラベル付きで編集し、field errorを該当入力へ関連付ける。
  - 保存中の再送信を抑止し、成功時は確定版、失敗時は入力内容と再試行手段を表示する。
  - キーボードだけで選択肢の追加・削除・順序変更と保存取消が完了できる。
  - _Boundary: QuestionEditor_
  - _Depends: 2.1, 2.3_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.3, 7.5_

- [x] 3.2 (P) 設問一覧と行操作を実装する
  - 設問文、有効状態、解説有無、疑義／解説追加flagを安定順で識別可能に表示する。
  - 共通行操作と確認dialogを使って編集、並べ替え、無効／再有効、flag解除、削除／取消を提供する。
  - 狭幅でも横スクロールなしで主要操作へ到達でき、操作結果とversion conflictが支援技術へ通知される。
  - _Boundary: QuestionList_
  - _Depends: 2.2, 2.3_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.3, 4.4, 4.5, 5.4, 7.3, 7.4, 7.5_

- [x] 3.3 設問バンク画面の状態とkeyword文脈を統合する
  - 教材内keywordの選択から対象設問だけを読み込み、loading、empty、loaded、not-found、errorを区別する。
  - 空状態には最初の設問作成導線、失敗時には再試行、競合時には現在版の再読込を提示する。
  - 作成・編集・一覧操作後に同じkeyword文脈と確定順序が画面へ反映される。
  - _Boundary: QuestionBankPage_
  - _Depends: 3.1, 3.2_
  - _Requirements: 1.1, 1.5, 2.7, 3.8, 5.4, 7.3, 7.4, 7.5, 7.6, 7.7_

- [ ] 4. アプリと下流consumerへ接続する
- [x] 4.1 設問管理画面のroute adapterをapp-shellへ引き渡す
  - feature-local `QuestionBankRoute.tsx`を実装し、`questions.bank`、`/questions`、`nav.questions.bank`、`設問`、`wide,narrow`と任意の階層UUID・許可済み`returnTo`を提供する。
  - `src/App.tsx`、feature route registry、共通navigationは変更せず、最終登録とwide／narrow導線の合成を`app-shell-and-responsive-experience` task 6.2へ引き渡す。
  - 直接表示・search付き再読込、階層開始、正常終了／取消の復帰、不正UUID・親子不一致・許可外`returnTo`の書込みなしerrorと`/`復帰をadapter contract testへ追加する。
  - URL直開きでも認証とkeyword所有確認を通り、権限外データを表示しない。
  - _Boundary: QuestionBankRouteAdapter_
  - _Depends: 3.3; upstream `app-shell-and-responsive-experience` task 6.1 descriptor contract_
  - _Requirements: 1.1, 1.5, 6.1, 6.4, 7.4, 7.8, 7.9, 7.10_

- [x] 4.2 下流向け設問・版・flag契約を統合検証する
  - study/exchangeが利用する教材全件読取、安定ID、version token、flag mutationをfeature公開境界から提供する。
  - 結果画面consumer相当の呼出しで疑義と解説追加を独立設定でき、既存解説があっても追加flagを設定できる。
  - 下流が設問テーブルへ独自書込をせず、公開契約だけで必要な状態を取得・更新できることが型と統合テストで確認できる。
  - _Boundary: StructuredQuestionReadContract, FlagMutationContract_
  - _Depends: 2.2, 2.3_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 7.2_

- [ ] 5. 設問バンクの回帰と品質ゲートを完成する
- [x] 5.1 (P) 入力・mapping・競合の単体テストを追加する
  - 空白、重複、模範解答との重複、解説null、選択肢順、DB行mapping、競合unionを境界値込みで検証する。
  - 共有正答正規化の変更を検出する回帰を含め、対象単体テストがすべて成功する。
  - _Boundary: QuestionContentPolicyTests, StructuredQuestionApiUnitTests_
  - _Depends: 2.1, 2.3_
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 5.2, 5.4_

- [x] 5.2 DB参照整合性と版競合の統合テストを追加する
  - keyword削除／章削除、owner・material不一致、期待版二重更新をローカルDBで検証する。
  - 並べ替えは全行成功または全行不変となり、成功時の順序・版・更新時刻を再取得で確認する。
  - bank所有の共有fixtureを作り、通常編集RPCとexchangeが呼ぶ非公開primitiveへ同一caseを与え、内容検証、版increment、未指定flag保持が一致する適合テストを直列実行する。
  - _Boundary: QuestionDatabaseConformance_
  - _Depends: 1.3, 2.3_
  - _Requirements: 3.3, 5.3, 5.4, 5.5, 5.6, 6.2, 6.3, 6.5, 6.6_

- [x] 5.3 (P) 1,001件超のページング適合テストを追加する
  - 1keywordと1materialに各1,001件以上を用意し、全件・安定順・重複なしを検証する。
  - ページ境界で同じsort orderが続いてもIDの一意順序で欠落しないことを確認する。
  - keyword単位と教材単位のvolumeテストが成功する。
  - _Boundary: QuestionVolumeConformance_
  - _Depends: 2.2_
  - _Requirements: 7.1, 7.2_

- [x] 5.4 (P) 新規RPCの4主体セキュリティ適合テストを追加する
  - DB catalogから公開user-data RPCを自動列挙し、`mutate_structured_question`（全command）と`reorder_structured_questions`がRpcSecurityMatrixに過不足なく存在することを検証する。
  - owner成功、cross-owner拒否、anon拒否、service roleはfixture準備・事後確認限定として公開RPCを検証する。primitiveは同じowner／cross-owner／anon／service-role matrixで自身の再検証も確認する。
  - DB catalogで`private`がexposed schemas外、primitiveが`SECURITY INVOKER`、空search path、正確なidentity argumentsであり、authenticatedだけに最小`USAGE`／当該signatureの`EXECUTE`、`PUBLIC`／`anon`に非許可であることを検証する。
  - anonとauthenticatedの双方からSupabase REST/RPC endpointでprimitiveを直接指定しても到達不能であり、公開bank RPCから同一transaction内の委譲が成功することを検証する。exchange orchestrationからの委譲は`question-generation-exchange` Task 5.3で検証する。
  - 通常Data APIと各RPCで他利用者の存在・現在内容を漏らさないことを検証する。
  - 4主体の権限回帰が直列実行で成功する。
  - _Boundary: QuestionRpcSecurityConformance_
  - _Depends: 1.4, 2.3_
  - _Requirements: 1.5, 6.1, 6.2, 6.3, 6.4, 6.7, 6.8, 6.9, 6.10_

- [x] 5.5 設問管理の主要利用者経路をE2E検証する
  - 作成、再読込、編集、順序、無効／再有効、flag、削除確認／取消、empty／error／retryをE2Eで検証する。
  - stale版による保存が現在内容を変えず、再読込導線から操作を継続できることを検証する。
  - 主要経路のE2Eが認証済みroute上で成功する。
  - _Boundary: QuestionBankFunctionalE2E_
  - _Depends: 4.1, 4.2, 5.2_
  - _Requirements: 1.1, 1.5, 2.1, 2.7, 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 5.4, 7.3, 7.6, 7.7_

- [x] 5.6 (P) レスポンシブとアクセシビリティのUI回帰を追加する
  - 広幅／狭幅で横スクロールなしに主要操作へ到達できることを検証する。
  - キーボード操作、入力ラベル、flag名、alert、確認dialog、連打防止を検証する。
  - 対象UI回帰がライト／ダークの既存tokenを崩さず成功する。
  - _Boundary: QuestionBankUiConformance_
  - _Depends: 4.1_
  - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 5.7 最終品質ゲートを実行する
  - 型検査、ユニットテスト、決定表カバレッジ、production build、対象E2Eを実行する。
  - 失敗を設問バンクの責務内で修正し、既存穴埋め学習の回帰を増やさない。
  - すべての必須品質コマンドが成功した状態を完了とする。
  - _Boundary: StructuredQuestionBankIntegration_
  - _Depends: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - _Requirements: 1.1, 2.7, 3.8, 4.5, 5.4, 6.1, 7.1, 7.3, 7.4, 7.5_

## Implementation Notes
- 疑義内容（2026-10-12追加）: migration 20261012000000 で structured_questions.doubt_note を追加し、primitive/mutate_structured_question のflag patchに doubt_note を許可。doubt_flag=false で自動消去、内容更新では保持。一覧では疑義内容を読み取り専用で表示する。
- 疑義の理由（2026-10-12追加）: migration 20261012010000 で structured_questions.doubt_reasons text[]（既定'{}'、5コードのみ・重複なし・doubt_flag=falseなら空のcheck）を追加し、primitive/mutate_structured_question のflag patchに doubt_reasons（文字列配列）を許可。正規順へ整列・重複除去、未知コードは22023、doubt_flag=falseで自動消去。コードとラベルは src/features/questions/doubtReasons.ts の DOUBT_REASONS が唯一の定義元で、一覧では選択した理由ラベルを表示する。
- 疑義の理由の統合（2026-10-12）: `weak_distractors`（誤答が簡単すぎる）を `answer_guessable` に統合し、ラベルを「知識がなくても解ける（問題文や選択肢から推測できる）」へ変更した。固定コードは `answer_guessable`／`low_value`／`defective`／`unclear` の4つ（この順が正規順）。新規migration `20261012020000_merge_doubt_reason_weak_distractors.sql` で既存行の `weak_distractors` を `answer_guessable` へ置換・重複除去・正規順化し（データ正規化のため版トリガーを一時無効化し `version`/`updated_at` は変えない）、CHECK制約と `private.apply_structured_question_content` のコード一覧を4コードへ置き換えた。設問交換codecも `weak_distractors` を拒否する。
