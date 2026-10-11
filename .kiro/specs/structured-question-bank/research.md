# 調査・設計判断

## Summary
- **Feature**: `structured-question-bank`
- **Discovery Scope**: Extension（新規データ境界を既存SPAへ統合）
- **Key Findings**:
  - 既存アプリは feature-first、Supabase直接接続、DB行からアプリ型への境界変換を採用しているため、`src/features/questions/` に閉じた実装が適合する。
  - 設問内容、選択肢、フラグを1行に保持すれば、通常保存は単一行の原子的更新となり、期待版による楽観的競合検知をDB内で完結できる。
  - 全件取得は catalog 所有の `src/lib/paged.ts` を利用し、新規RPCは identity 所有の `RpcSecurityMatrix` へ登録する必要がある。
  - 横断レビューにより、bankが非公開DB mutation primitiveと共有fixtureを所有し、通常編集RPCとexchange orchestrationだけが同一transactionで呼ぶ構成に固定した。primitiveも公開RPCも`SECURITY INVOKER`なので、`private`をPostgREST非公開schemaに保った上で、authenticatedへ最小schema `USAGE`と正確なprimitive signatureへの`EXECUTE`が必要である。公開RPCはDB catalogから自動列挙し、featureは`App.tsx`でなくローカルroute adapterだけを所有する。

## Research Log

### 既存の拡張点
- **Context**: 新しい設問管理を既存画面・認証・DBへ安全に接続する必要がある。
- **Sources Consulted**: `src/App.tsx`、`src/features/*/api.ts`、`structure.md`、既存7仕様
- **Findings**: ページが状態を統合し、featureの`api.ts`がSupabase境界を持つ。共通dialog、行操作、submit guard、ページングは上流仕様が所有する。
- **Implications**: `QuestionBankPage`、設問専用API、純粋な入力検証に限定し、共有部品は変更せずconsumerとして使う。

### データ整合性と競合
- **Context**: 同じ設問が通常編集と外部ファイルで更新される将来要件がある。
- **Sources Consulted**: `brief.md`、`contracts.md`、PostgreSQL/Supabaseの既存migration規約
- **Findings**: クライアント時刻だけの比較は精度・時刻差に弱い。DBの整数版と期待版を比較するほうが明確である。選択肢はこの機能内で独立CRUDを必要としない。
- **Implications**: 単調増加`version`を正とし、`updated_at`は監査表示用とする。選択肢は順序付きJSON配列で設問行と同時更新する。

### 件数とセキュリティ
- **Context**: 1,000行上限、owner分離、複合参照整合性を満たす必要がある。
- **Sources Consulted**: `tech.md`、`contracts.md`、`learning-content-catalog/design.md`、`identity-and-access/design.md`
- **Findings**: 全行取得は安定一意順序が必須。RLSだけでなく、設問とkeywordのowner/material一致をDB制約で拒否する必要がある。
- **Implications**: `(keyword_id, material_id, owner_id)`の複合外部キー、owner RLS、認証role限定RPC、4主体回帰を導入する。

### 非公開primitiveの到達性とinvoker権限
- **Context**: 公開bank／exchange RPCとbank primitiveをすべて`SECURITY INVOKER`にすると、呼出し主体にprimitiveの実行権がなければnested callも失敗する。一方、primitiveをData APIへ公開してはならない。
- **Decision**: `private` schemaをSupabase/PostgREST exposed schemasから除外する。`authenticated`へ`USAGE ON SCHEMA private`と`EXECUTE ON FUNCTION private.apply_structured_question_content(uuid, uuid, bigint, jsonb, jsonb)`だけを付与し、`PUBLIC`／`anon`からはrevokeする。primitive自身も空search path、完全修飾名、`auth.uid()`再検証を行う`SECURITY INVOKER`とする。
- **Validation**: DB catalogでschema公開設定、function identity arguments、`prosecdef=false`、search path、ACLを検証し、anon／authenticatedのREST/RPC直接呼出しが到達不能であることと、公開RPC経由のowner／cross-owner／anon／service-role matrixを確認する。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| feature-first + 単一行aggregate | 設問内容・選択肢・フラグを設問行で管理 | 原子的更新、既存構造と一致 | 選択肢単体検索には不向き | 現要件に最小 |
| 設問と選択肢を別テーブル化 | 選択肢を子行で管理 | 選択肢の独立操作に強い | 保存transactionと版管理が複雑 | 現要件では過剰 |
| keyword行へ設問JSONを埋込 | keywordの一部として保持 | 表面上は単純 | 設問ID、個別版、下流参照が弱い | 不採用 |

## Design Decisions

### Decision: 整数版を競合判定の正とする
- **Context**: export後の通常編集を古いimportが上書きしてはならない。
- **Alternatives Considered**: 更新日時比較、内容hash、単調増加整数版
- **Selected Approach**: 全変更でDBが`version + 1`し、更新は`expectedVersion`一致時だけ成功させる。
- **Rationale**: 時刻精度に依存せず、下流ファイルへ小さく安定したtokenを渡せる。
- **Trade-offs**: 並べ替えやフラグだけでも競合になるが、古い内容による状態の巻き戻しを防げる。

### Decision: 選択肢は設問行の順序付きJSON配列
- **Context**: 選択肢は設問と同時に編集・検証され、単体識別を求められていない。
- **Selected Approach**: `jsonb`配列として設問aggregateに含める。
- **Rationale**: 一行更新で内容・順序・版を原子的に確定できる。
- **Trade-offs**: 将来選択肢個別分析が必要ならmigrationを伴う再設計が必要。

### Decision: migrationとRPCを本仕様が所有する
- **Context**: owner/keyword整合性と期待版更新をクライアントだけに任せられない。
- **Selected Approach**: `20261011000000_create_structured_questions.sql`でテーブル、制約、RLS、trigger、save/reorder RPCを追加する。
- **Rationale**: 予約済みmigrationの後ろで一意となり、設問境界の変更を一箇所で導入できる。
- **Follow-up**: RPC一覧変更としてidentityの4主体権限テストを再検証する。

## Risks & Mitigations
- 大量設問で一覧が欠落する — `(keyword_id, sort_order, id)`順の共通ページングと1,001件統合テストで防ぐ。
- 別owner/教材のkeywordへ関連付く — 複合外部キー、RLS、cross-ownerテストで防ぐ。
- 二重保存や古い画面が上書きする — submit guardと期待版比較、409相当の競合表示で防ぐ。
- 下流仕様が設問マスタを書き換える — 公開contractをconsumerとして利用し、所有境界と再検証条件を明記する。

## References
- `.kiro/steering/contracts.md` — ページング、共通UI、RPC権限の共有契約
- `.kiro/specs/learning-content-catalog/design.md` — keywordの複合整合性とStablePagedReader
- `.kiro/specs/identity-and-access/design.md` — RpcSecurityMatrix
