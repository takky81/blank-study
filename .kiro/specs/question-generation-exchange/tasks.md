# 実装計画

- [x] 1. 交換schemaとeligibility純粋契約を実装する
- [x] 1.1 (P) eligibility閾値と固定論理式を型安全に実装する
  - 最低出題回数、最大正答率、最大設問数の入力型、範囲検証、field errorを定義する。
  - 疑義 OR 解説追加 OR（誤答1以上 AND 出題回数下限以上 AND 正答率上限以下 AND 設問数上限以下）を共有fixtureで表現する。keyword集計はactive設問だけのsum、差分、比率、active countを使い、statsなし／attempts 0を統計対象外にする。
  - 各境界値、AND群の1条件不足、複数理由の重複排除がunit testで観測できる状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: EligibilityFilter_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.4, 2.5, 2.7_

- [x] 1.2 (P) versioned JSON schema v1とcodecを実装する
  - `QuestionExchangeExportV1`、`QuestionExchangeTargetV1`、`ChapterContextV1`、filters、create/update operation、requested/resolved flags、path付きerrorの判別可能な型を全field・型・nullabilityどおり定義する。
  - UTF-8 JSONのserialize/parse、schema version、必須型、unknown/delete kind、createへのID混入、updateのID/版欠落を検証する。
  - `src/features/questionExchange/fixtures/question-exchange-v1.export.json`をgolden fixtureとし、member追加拒否、null/空配列、target/path/question/flagの安定順、EligibilityTarget写像、requestedFlagsからsourceRequestedFlagsへの不変複製を検証し、round tripと不正fixtureが成功値または正確なJSON path付きerrorへ分類される状態を完了条件とする。
  - **見積り: 2〜3時間**
  - _Boundary: ExchangeSchema, ExchangeCodec_
  - _Requirements: 3.1〜3.5, 3.8〜3.12, 4.1, 4.2, 4.6_

- [x] 1.3 import operationの内容・重複検証を上流契約へ接続する
  - outer operationのkeywordIdと、keywordIdを持たないQuestionContentDraftを用い、内外不一致を型/schema上表現不能にする。question bank所有のQuestionContentPolicyを利用し通常編集と同じ規則で検証する。
  - 同じquestion IDの複数update、keyword/question不一致、sourceRequestedFlagsを超えるresolved flagsを保存不可errorへ分類する。
  - 有効operationが混在しても1 errorで全体のcanCommitがfalseになるunit testを完了条件とする。
  - **見積り: 2時間**
  - _Boundary: ExchangeValidationAdapter_
  - _Depends: 1.2; upstream `structured-question-bank` tasks 2.1, 5.1_
  - _Requirements: 4.2, 4.4, 4.5, 4.6, 4.7, 6.6_

- [x] 2. DB側eligibility集計とexport projectionを追加する
- [x] 2.1 owner付きeligibility RPCを実装する
  - `20261011020000_create_question_generation_exchange.sql`を追加し、questionsと専用statsをkeyword単位で集計する`get_question_exchange_candidates`を定義する。
  - `auth.uid()`を起点に固定式を評価し、穴埋め履歴を参照しない。常にkeyword単位で1 targetを返し、複数flag設問を`flaggedQuestions[]`へ設問別requestKinds付きで入れ、統計理由を同じtargetへ統合する。
  - owner入力を受け取らず、1,000件を超えてもDB内集計結果が欠落しないRPC結果を完了条件とする。
  - **見積り: 3時間**
  - _Boundary: EligibilityRPC_
  - _Depends: 1.1; upstream `structured-question-bank` tasks 1.1〜1.4 and `structured-question-study` tasks 1.1〜1.3_
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.7_

- [x] 2.2 eligibility結果へ階層・本文・設問版を接続する
  - keyword UUIDから科目、教材、本文に出現する章pathと関連本文を取得し、provenance chapterをmembershipとして扱わないexport projectionを作る。
  - question read contractから全active設問の現在内容、版、sortOrder、requested flagsを結合し、target/path/question/flagと列挙集合をExchange schema v1所定の安定順へ整える。
  - 同一keywordの複数章出現、複数flag設問、統計理由の併存でもtargetが1件で、全階層path・章Markdown・metrics・版を含み、EligibilityTargetとrequestedFlagsがgolden fixtureに完全一致する結果を完了条件とする。
  - **見積り: 2〜3時間**
  - _Boundary: EligibilityExportProjection_
  - _Depends: 2.1; upstream `learning-content-catalog` paging contract and `markdown-keyword-authoring` body membership contract_
  - _Requirements: 2.3, 2.4, 2.5, 3.2〜3.4, 3.8〜3.12_

- [x] 2.3 eligibility RPC gatewayと操作文脈付きerrorを実装する
  - feature APIでfilterをRPC入力へ変換し、DB rowをQuestionExchangeExportV1へ型安全にmappingする。
  - 0件、通信失敗、2ページ目相当の補助読取失敗を不完全artifactと区別し、失敗時にdownload可能値を返さない。
  - owner対象だけの安定したenvelopeまたは再試行可能な日本語Errorが得られるunit/integration testを完了条件とする。
  - **見積り: 2時間**
  - _Boundary: QuestionExchangeApi, EligibilityGateway_
  - _Depends: 1.2, 2.2_
  - _Requirements: 2.1, 2.3, 2.6, 3.1, 3.6_

- [x] 3. browser export/uploadとpreviewを実装する
- [x] 3.1 (P) JSON download/upload adapterを実装する
  - schema v1をUTF-8 JSON Blobとして安全なfilenameでdownloadし、選択fileをUTF-8文字列として読み取るadapterを作る。
  - 対象0件ではdownloadせず、invalid encoding/JSONは書込み前のpath付きerrorへ変換する。
  - download artifactの再parse round tripと、空結果・壊れたfileでdownload/importが進まないtestを完了条件とする。
  - **見積り: 2時間**
  - _Boundary: BrowserFileAdapter_
  - _Depends: 1.2, 2.3_
  - _Requirements: 3.1, 3.5, 3.6, 4.1_

- [x] 3.2 current snapshotからimport preview planを作る
  - validated operationに対してowner-scoped current question/keyword snapshotを取得し、create/update/stale/unknown/errorへ分類する。
  - updateはbefore/after、staleは現在内容・現在版とincomingを保持し、error/conflictが1件でもあればcanCommit=falseにする。
  - unknownとforeign参照は同じerror表現にし、preview作成がDBを書き換えないことをintegration testで確認する。
  - **見積り: 2〜3時間**
  - _Boundary: ImportPreviewPlanner, PreviewReadAdapter_
  - _Depends: 1.3; upstream `structured-question-bank` read/version contract_
  - _Requirements: 4.3, 4.7, 5.1, 5.2, 5.3, 5.4, 5.6, 7.3_

- [x] 3.3 exchange画面の条件入力、出力、upload、previewを接続する
  - filter field、export、file input、区分別件数と内容、cancel/commitをQuestionExchangePageへ統合する。
  - shared submit guardでexport/importの二重送信を防ぎ、loading/empty/errorを区別してfileとpreviewを再試行可能に保持する。
  - narrow/wide双方で横スクロールなしに主要操作へ到達し、label、focus、alert、keyboard操作を確認できるcomponent testを完了条件とする。
  - **見積り: 3時間**
  - _Boundary: QuestionExchangePage_
  - _Depends: 3.1, 3.2; upstream `app-shell-and-responsive-experience` submit guard/shared UI_
  - _Requirements: 1.2, 1.6, 3.6, 3.7, 5.1, 5.3, 5.4, 5.6, 6.8, 7.5, 7.6, 7.7_

- [x] 3.4 交換画面のroute adapterをapp-shellへ引き渡す
  - feature-local `QuestionExchangeRoute.tsx`を実装し、`questions.exchange`、`/question-exchange`、`nav.questions.exchange`、`設問交換`、`wide`をapp-shellへ提供する。未認証は既存login flowへ委ねる。
  - 任意の階層UUID検索parameterと許可済み`returnTo`を検証し、正常終了／取消は検証済み復帰先、不正paramは書込みなしのerrorと`/questions`復帰にする。
  - `src/App.tsx`、feature route registry、共通navigationは変更せず、最終登録とwide／narrow導線の合成を`app-shell-and-responsive-experience` task 6.2へ引き渡す。
  - 共通route shellを再定義せず、直接表示、再読込、開始文脈、正常復帰、不正UUID・階層不一致・許可外復帰先を含むadapter contract testを完了条件とする。
  - **見積り: 1時間**
  - _Boundary: QuestionExchangeRouteAdapter_
  - _Depends: 3.3; upstream `app-shell-and-responsive-experience` task 6.1 descriptor contract_
  - _Requirements: 7.1, 7.2, 7.6, 7.7, 7.12, 7.13, 7.14_

- [x] 4. 原子的import RPCとgatewayを実装する
- [x] 4.1 atomic import RPCで全operationを再検証する
  - migration内の`import_question_exchange`で全keyword/question owner、関連、content、expectedVersion、duplicate、resolvedFlags subsetを変更前に検証する。
  - file/clientのowner値とpreview結果を信頼せず、`auth.uid()`とcurrent DB stateから判断し、stale時は全件を拒否する。
  - create/updateの混在payloadが全検証後だけbank所有の`private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)`へ進み、primitive自身も`auth.uid()` owner、keyword、question、期待版、内容、flag不変条件を再検証するDB integration testを完了条件とし、exchange内に重複する業務mutationを作らない。
  - **見積り: 3時間**
  - _Boundary: AtomicImportRPCValidation_
  - _Depends: 1.3, 3.2; upstream `structured-question-bank` mutation/version contract_
  - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 5.4, 5.5, 6.1, 7.1, 7.3, 7.9, 7.10, 7.11_

- [x] 4.2 create/updateと選択的flag解除を同一transactionで確定する
  - `SECURITY INVOKER`の公開import orchestration RPCから、API非公開`private` schemaに対するauthenticatedの最小`USAGE`／正確なsignatureへの`EXECUTE`を使い、bank primitiveを同一transaction内で呼ぶ。新規設問は安定IDを割り当て、更新はexpectedVersion一致時だけ内容と版を進める。
  - export時requestedかつoperationでresolvedとされたflagだけを解除し、未指定flagとfile外設問を維持する。
  - bank所有の共有conformance fixtureを変更せず消費し、通常編集とimportの内容検証・版increment・flag保持が一致し、成功結果がcreated/updated/各flag cleared countを返すことを完了条件とする。
  - **見積り: 3時間**
  - _Boundary: AtomicImportRPCMutation_
  - _Depends: 4.1_
  - _Requirements: 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 7.9, 7.10, 7.11_

- [x] 4.3 import RPC gatewayと画面のcommit状態を接続する
  - canCommit=trueのvalidated envelopeだけをRPCへ渡し、結果countを画面型へmappingする。
  - stale/参照/内容/DB failureを操作文脈付きErrorへ変換し、失敗時はpreviewを維持、成功時は最新状態を再読込する。
  - preview後に別更新されたcaseが自動上書きされず、成功時だけsummaryと再読込が観測できるE2Eを完了条件とする。
  - **見積り: 2時間**
  - _Boundary: QuestionExchangeApi, AtomicImportAdapter, QuestionExchangePage_
  - _Depends: 3.3, 4.2_
  - _Requirements: 5.4, 5.5, 6.2, 6.7, 6.8, 7.5_

- [x] 5. DB原子性・大量件数・権限を検証する
- [x] 5.1 (P) eligibilityの1,001件回帰を追加する
  - 1,001件を超えるkeywords/questions/statsと複数章本文出現をseedし、flag branch、統計branch、複数理由、末尾対象を検証する。
  - active-onlyのattempts/correct/wrong/accuracy/questionCount、statsなし、attempts 0、inactive/deleted除外を検証する。同一keywordの複数flag設問は1 targetへnestedされ、設問別requestKindsと統計理由が同居する。
  - 結果件数、schema v1所定の全安定順、理由集合、metrics、全階層path/章本文、questions、flaggedQuestions、穴埋め履歴非混入がgolden fixtureへ欠落・重複なしで一致する状態を完了条件とする。
  - **見積り: 2〜3時間**
  - _Boundary: QuestionExchangeVolumeConformance_
  - _Depends: 2.2, 2.3_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 5.2 (P) import transaction内部失敗のrollbackを検証する
  - valid create/update処理後にDB constraintで確実に失敗するfailure injection payloadまたはtest-only transaction fixtureを用意する。
  - authenticated利用者として実RPCを呼び、前後でquestions、version、両flagが全件不変で途中作成行もないことを管理用clientで確認する。
  - 通信abortではなくRPC内部例外による全rollbackが観測できる状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: QuestionExchangeAtomicityConformance_
  - _Depends: 4.2_
  - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 5.3 (P) 新規RPCの4主体security適合テストを追加する
  - DB catalogから公開user-data RPCを自動列挙し、eligibility/import RPCを含む全件がidentity所有のRpcSecurityMatrix fixtureに過不足なく存在することを検証する。
  - authenticated owner成功、cross-owner非開示、anon実行拒否を検証し、service roleはfixture準備・事後確認だけに使用する。
  - 公開RPCの`SECURITY INVOKER`、空search path、schema修飾、authenticated限定grantと、通常read/RPCのowner境界が一致する状態を完了条件とする。
  - DB catalogで`private`がSupabase/PostgREST exposed schemas外、primitiveが`SECURITY INVOKER`、空search path、正確なidentity argumentsで、authenticatedだけに最小schema `USAGE`／当該signatureの`EXECUTE`があり、`PUBLIC`／`anon`にないことを検証する。
  - anon／authenticatedからSupabase REST/RPCでprimitiveを直接指定しても到達不能であること、および公開importから同一transactionで委譲した際のprimitive再検証をowner／cross-owner／anon／service-role matrixで確認する。
  - **見積り: 2時間**
  - _Boundary: QuestionExchangeRpcSecurityConformance_
  - _Depends: 2.1, 4.2; upstream `identity-and-access` task 6.7_
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.8, 7.10, 7.11_

- [ ] 6. 利用者経路と最終品質ゲートを完了する
- [ ] 6.1 exportからpreviewまでの手動AI交換経路をE2Eで検証する
  - filter入力からJSON download、外部で編集したfixture upload、新規/更新preview、cancelまでを直列E2Eで実行する。
  - flag単独と統計AND群、0件、invalid JSON/schema、duplicate、unknown参照、不正選択肢、delete命令を含める。
  - export artifactをgolden fixtureと比較し、sourceRequestedFlags改変を拒否する。外部AI通信が発生せず、各caseが期待するartifactまたは保存不可表示になる状態を完了条件とする。
  - **見積り: 3時間**
  - _Boundary: QuestionExchangeFunctionalE2E_
  - _Depends: 3.4, 5.1_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.1, 5.6_

- [ ] 6.2 原子的commitと競合経路をE2Eで検証する
  - create/update混在、片flag/両flag解除、file外flag維持、成功summaryと再読込を検証する。
  - preview後編集によるstale、foreign owner、failure injectionで自動上書き・部分保存・意図しないflag解除がないことを確認する。
  - narrow/wide、keyboard、focus、alert、二重送信防止を含む利用者経路が成功する状態を完了条件とする。
  - **見積り: 3時間**
  - _Boundary: QuestionExchangeCommitE2E, QuestionExchangeUiConformance_
  - _Depends: 4.3, 5.2, 5.3, 6.1_
  - _Requirements: 5.2, 5.3, 5.4, 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.10, 7.11_

- [ ] 6.3 全品質ゲートと上流契約を再検証する
  - bank、study、catalog/authoring、app-shell、identityの上流task完了を確認し、新migrationをlocal Supabaseへ適用する。
  - typecheck、questionExchange unit、全unit、決定表coverage、production build、exchange E2Eと上流bank/study回帰を実行する。
  - schema/version、専用stats、本文membership、paging、submit guard、RpcSecurityMatrixの再検証がすべて成功する状態を完了条件とする。
  - **見積り: 2時間**
  - _Boundary: QuestionGenerationExchangeIntegrationValidation_
  - _Depends: 6.2_
  - _Requirements: 2.2, 2.3, 4.3, 5.5, 6.2, 7.8_

## Implementation Notes
- keyword export: displayText = answers[0]、modelAnswer = answers.join("、")（design未定義のため2.2で決定）。eligibility RPCはPostgREST max_rows=1000回避のため単一jsonb配列を返す。新規公開RPCは e2e/rpc-security-matrix.ts の末尾へ追加する（既存specが位置indexを参照）。
- import_question_exchange のエラー: 22023=検証エラー、P0002=未知/他owner参照（同一表現）、PT409(HTTP 409)=stale版。40001はPostgRESTが再試行してtimeoutするため使わない。成功は {createdCount, updatedCount, clearedDoubtCount, clearedExplanationRequestCount}。private primitiveへのUSAGE/EXECUTEはbank migration 000004/000005で付与済み。
