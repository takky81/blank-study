# 調査・設計判断記録

## Summary

本機能は既存SPAへの複雑な統合であるため、軽量discoveryを実施した。設問バンクの安定ID・単調増加版・フラグ契約と、設問学習の専用statsを入力にし、交換機能はDB側eligibility集計、versioned JSON、preview、原子的importだけを所有する。外部AI接続や新規依存は追加しない。

横断レビューにより、export targetはkeyword単位の1行とし、複数flag設問を設問別request kind付き配列へ格納する。importはouter keywordIdとkeywordIdを持たないcontent draftを使い、公開orchestration RPCからbankのAPI非公開mutation primitiveへ同一transaction内で委譲する。featureは`App.tsx`を所有しない。

## Research Log

### 上流設問契約
- `structured-question-bank`は`StructuredQuestion`、`QuestionVersionToken`、設問内容検証、疑義／解説追加フラグを所有する。
- exchangeは通常CRUDを再実装せず、公開read contractと同じ内容規則を利用する。
- implication: export時版を更新payloadに保持し、previewとcommitの双方で一致を要求する。

### 専用学習統計
- `structured-question-study`は`structured_question_stats`と回答logを穴埋め学習から分離する。
- eligibilityはactive設問だけについて`attempts=sum(asked_count)`、`correct=sum(correct_count)`、`wrong=attempts-correct`、`accuracy=correct/attempts`、`questionCount=count(active question)`を使用する。statsなしは件数0、attempts 0はaccuracy nullとしてAND群を満たさず、inactive／deleted設問は除外する。
- implication: client全件取得による集計ではなく、認可済みDB projection/RPCで対象と理由を返す。

### 既存ファイル交換パターン
- `material-portability`はbrowser download/upload、事前検証、原子的RPC、操作文脈付きエラーを採用する。
- zip契約は教材移植専用であり、AI作業用schemaへ拡張しない。
- implication: browser File APIとdownload helperの利用パターンだけを踏襲し、独立したJSON schemaを持つ。

### 大量件数と整合性
- Supabase/PostgRESTには1回1,000行上限がある。候補判定にはquestions、stats、keywords、階層、本文が跨る。
- implication: eligibilityはDB内集計で行い、export detailはRPC結果またはcatalog所有の安定ページングadapterで欠落なく構成する。
- importは1 RPC transactionで全入力を再検証し、途中例外をfailure injectionでrollback確認する。

### セキュリティ
- identity steeringは新規user-data RPCをowner成功、cross-owner非開示、anon拒否、service role準備限定の4主体で検証する。
- implication: aggregateとimportの両RPCを列挙型`RpcSecurityMatrix`へ追加し、ブラウザpayloadのowner値を信頼しない。
- bank／exchangeの公開RPCとprimitiveは`SECURITY INVOKER`であるため、nested callにはauthenticatedのDB実行権が必要である。bank所有の`private` schemaをPostgREST exposed schemasから除外し、authenticatedへ最小`USAGE`と正確なprimitive signatureへの`EXECUTE`だけを与えることで、DB内部委譲を可能にしつつREST/RPC直接到達を防ぐ。
- implication: catalogでschema公開設定・signature・invoker・search path・ACLを検証し、直接API到達不能と、公開import→primitiveのowner／cross-owner／anon／service-role matrixを別々に確認する。

## Architecture Pattern Evaluation

| 案 | 判断 | 理由 |
|---|---|---|
| clientで全件取得して集計 | 不採用 | 1,000件上限、集計ずれ、過剰なデータ転送を招く |
| DB eligibility RPC + client schema policy + atomic import RPC | 採用 | 認可、集計、原子性の境界をDBで保証し、previewは純粋ロジックとして試験可能 |
| 外部AI API連携 | 不採用 | 手動PC操作という要求・境界に反する |
| 教材zip形式への同居 | 不採用 | 移植と生成依頼は変更理由、参照、競合規則が異なる |

## Design Decisions

### Decision: schema版付きUTF-8 JSON
- `schemaVersion`、`exportedAt`、filters、targetsを持つexport envelopeと、operationsを持つimport envelopeを分離する。
- updateはquestionIdとexpectedVersion必須、createはquestionId禁止、delete operationは型に存在させない。
- unknown schema versionはfail closedとする。

### Decision: eligibilityの固定論理式
- flag branchはkeyword target内の`flaggedQuestions[]`へ設問単位のupdate requestを格納し、stats branchは同じkeyword targetへcreate理由を追加する。keyword target自体は常に1件である。
- 同じkeyword・questionの理由は集合として重複排除し、安定ID順で出力する。
- accuracyはkeyword内の合計attemptsに対する合計correctの比率とし、閾値比較は`<=`、件数比較も境界を含む。

### Decision: 二段階検証
- upload時にparse/schema/重複/内容/参照/現在版を検証してpreviewを作る。
- commit RPCは同じowner、参照、内容、expectedVersionをtransaction内で再検証する。
- preview tokenだけを信頼せず、TOCTOUをversion再照合で閉じる。

### Decision: selective flag clearing
- export targetが保持するrequestedReasonsとimport operationの`resolvedFlags`の積集合だけを解除する。
- create operationと統計理由は既存設問flagを解除しない。
- flag解除もquestion updateと同一transactionに含めるためversionは1 operationにつき一貫して進む。

## Risks and Mitigations

- **巨大JSONのメモリ負荷**: 初期版はbrowser memory処理を維持し、全件欠落防止と明確な失敗を優先する。streamingは将来変更。
- **AIがschemaを壊す**: path付き検証エラーとpreviewで保存前に修正可能にする。
- **export後編集**: expectedVersionをpreview/commit双方で検証し自動上書きを禁止する。
- **cross-owner ID probing**: 不明と非所有を同じ参照エラーへ丸め、DB側でもauth.uidを基準にする。
- **集計と出力の時間差**: export RPCの一貫した結果からenvelopeを作り、表示時点のversionを含める。

## Synthesis

- 新規依存は不要で、React、TypeScript、Supabase/PostgreSQL、browser File APIで完結する。
- schema、eligibility、previewは純粋型・関数として切り出し、DBは認可・大量集計・transactionを担当する。
- migrationは上流`20261011010000_create_structured_question_study.sql`の後となる`20261011020000_create_question_generation_exchange.sql`を使用する。
- 交換機能はquestion CRUD、stats記録、AI通信を吸収せず、将来のAI自動化が同じschemaを消費できる境界を保つ。

## Consulted Guidance

- `.kiro/steering/product.md`, `tech.md`, `structure.md`, `contracts.md`
- `structured-question-bank`, `structured-question-study`, `material-portability`のrequirements/design/tasks
- `kiro-spec-design`のlight discovery、design principles、synthesis、review gate
