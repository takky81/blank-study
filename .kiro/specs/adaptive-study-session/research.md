# 調査と設計判断

## Summary

- **Feature**: `adaptive-study-session`
- **Discovery Scope**: Extension（既存実装のベースライン化）
- **Key Findings**:
  - 学習フローは `StudyPage` が一時状態を統合し、順序、形式、選択肢、表示、判定、成績、SRS は副作用のない関数へ分離されている。
  - 上流との安定した継ぎ目は、教材／章の ID と順序、章本文内の文書内 ID、キーワードの `answers`／`tags`／`wrongChoices`／`isActive` である。
  - 正答正規化とキーワード照合は authoring、全件ページングと構造整合性は catalog が所有する。study は feature adapter と統合回帰だけを所有する。
  - キーワードのページング、純粋ロジック、主要利用者経路には直接証拠がある一方、authoring 共有照合への統一、全スコープ行のページング、記録原子性、同一セッションの最新 SRS 状態、別解更新の全段階失敗には実ギャップがある。

## Research Log

### 出題 read model と上流契約

- **Context**: study が教材カタログと Markdown キーワード編集のどこまでを利用し、どこからを所有するかを固定する必要があった。
- **Sources Consulted**: `src/features/study/api.ts`、`StudyPage.tsx`、`src/features/chapters/tree.ts`、`src/lib/keyword.ts`、`learning-content-catalog/design.md`、`markdown-keyword-authoring/design.md`
- **Findings**:
  - `loadStudyData` は科目または教材を入口に、教材、章、キーワード、学習状態を read model へ変換する。
  - 候補は章の保存順と本文内の文書内 ID 出現順で構成され、非活性キーワード、本文に現れないキーワード、重複出現を除く。
  - 章ツリーの意味、owner／material／parent 整合性、全件ページングは `learning-content-catalog`、キーワード記法、正答正規化、overlap／duplicate、内容／活性状態は `markdown-keyword-authoring` が所有する。
  - `keywords.chapter_id` は provenance hint に限られ、出題所属は章本文の doc ID 出現から求める。
- **Implications**: 本仕様は上流の ID、順序、本文、キーワード属性を読み取る adapter に限定し、通常編集・共有照合ロジック・ページング helper・活性同期・章管理を取り込まない。

### 出題、表示、判定の純粋契約

- **Context**: 決定表 12〜18 と実装の対応を確認した。
- **Sources Consulted**: `order.ts`、`question.ts`、`range.ts`、`score.ts`、`alt.ts`、`srs.ts`、`src/lib/answer.ts`、`src/lib/keywordMatch.ts`、`src/lib/markdown.ts`、対応する unit tests、`spec/tables/12-order.jsonl`〜`18-srs.jsonl`
- **Findings**:
  - 自動順は未出題、`dueAt` 昇順、同着乱数の順で、出現順は `position` だけを使う。候補10件以上では直近10件を避け、選べない場合は緩和する。
  - 自動形式の定着閾値は3回以上かつ90%以上。誤答0件では記述へ落とす。
  - 選択肢は登録済み誤答を優先し、共通タグと章距離で補い、正規化した重複と正答を除外する。固定の「わからない」は常に不正解である。
  - 判定は前後空白、全角ASCII範囲、大文字小文字だけを正規化する。読み、部分一致、半角カナは吸収しない。
  - 表示は同じ文書内 ID の全出現を空欄にし、共通タグを伏せ、判定後に戻す。Markdown 表内のキーワード記述も共通 parser が保持する。
- **Implications**: これらは再設計せず、既存の関数契約と決定表を設計インターフェースとして固定する。

### 永続化と所有者境界

- **Context**: 解答履歴、SRS、別解が複数表を更新するため、データ所有と失敗境界を確認した。
- **Sources Consulted**: `src/features/study/api.ts`、`supabase/migrations/20260829000000_init.sql`、`20260831000000_grants.sql`、`e2e/study.spec.ts`、`tech.md`
- **Findings**:
  - `answer_logs` は解答時点の形式、入力、正誤、範囲拡張、時刻を保持し、`keyword_stats` は累積数と SRS 状態をキーワードごとに保持する。
  - 全対象表は `owner_id` と RLS を持ち、認証利用者だけが操作できる。
  - 現在の解答記録は履歴 insert と学習状態 upsert の別要求、別解登録は正答更新、最新履歴更新、学習状態更新の別要求である。
  - 現行 `registerAlternative` は `StudyPage` の解答前 `current.keyword.stats` を使い、直前の不正解を正解として SRS 計算し直す。誤答保存後の DB 状態だけでは、その前の repetition／interval／easeFactor を復元できない。
  - steering は複数テーブルの原子的更新を単一 PostgreSQL RPC へ寄せるとしており、現行の部分成功余地は既知ギャップである。
- **Implications**: ベースラインは現行の成功時契約と、失敗時に警告して判定を保ったまま継続し、既に成功した書込みを維持する契約を記録する。原子化後は record RPC が解答前状態を履歴へ保存し、alternative RPC がその DB snapshot を読む。自動再送や永続冪等 key は現行証拠がないため要求しない。

### 大量件数とセッション内状態

- **Context**: 1,000件超と、誤答後に同じ問題を再出題する経路を確認した。
- **Sources Consulted**: `src/features/study/api.ts`、`StudyPage.tsx`、`src/lib/paged.ts`、`e2e/study.spec.ts`、`12-order.jsonl`
- **Findings**:
  - キーワードは `fetchAll` で全ページ取得し、E2E は1章1,001キーワードを検証する。
  - 科目配下の教材と章は単一取得のため、1,000教材または1,000章を超える経路の欠落防止は実装・E2Eとも確認できない。
  - 記録成功後のローカル更新は累積数と期限だけを書き換え、`repetition`、`interval`、`easeFactor` を返却結果で更新しない。誤答後に同じ問題へ答えると、次の SRS 計算へ古い状態を渡す可能性がある。
- **Implications**: キーワードの1,001件証拠は完了扱いにできるが、スコープ全体の全件取得と連続解答の SRS 整合性は未完了とする。

### テスト資産とレビュー範囲

- **Context**: ベースラインタスクを完了扱いにする直接証拠と、推測で完了にしてはいけない範囲を分けた。
- **Sources Consulted**: `src/features/study/*.test.ts`、`src/lib/answer.test.ts`、`src/lib/markdown.test.ts`、`e2e/study.spec.ts`、決定表カバレッジスクリプト
- **Findings**:
  - 純粋ロジックには列番号付き unit test があり、主要な setup、answer、display、alternative、failure、1,001件経路には E2E がある。
  - 記録失敗 E2E は、失敗を警告し、判定を保って継続し、成功していない記録の成績を表示しない現行契約を検証する。自動再送の実装証拠はない。
  - 別解失敗 E2E は最初のキーワード更新失敗だけを注入し、後段失敗時のロールバックは検証しない。
- **Implications**: `tasks.md` は直接証拠のある既存仕事だけ `[x]` とし、共有照合 adapter、構造ページング／provenance、記録原子性、最新 SRS、別解原子性は `[ ]` にする。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 現行 feature-first と純粋ポリシー | Page がフローを統合し、純粋関数と API 境界へ委譲する | 既存コード・unit test・steering と一致する | Page が大きく、一時状態の更新漏れを起こし得る | ベースラインとして採用 |
| 新規ドメインサービスへ全面移行 | セッション状態機械を別モジュールへ集約する | 状態遷移を単体検証しやすい | 現行挙動の仕様化を超え、新しい実装を要求する | 不採用 |
| 決定表ごとの独立 feature | 7表を別境界にする | 表単位の追跡は容易 | 同じセッション状態とデータを重複所有する | 不採用 |

## Design Decisions

### Decision: 学習セッションを1つの業務境界に保つ

- **Context**: 順序、形式、表示、判定、SRS は別の純粋関数だが、利用者からは1問の状態遷移である。
- **Alternatives Considered**:
  1. 決定表ごとに spec を分ける
  2. Page 全体を1コンポーネントとしてのみ記述する
  3. 1 spec 内で純粋ポリシーと統合 Page を分ける
- **Selected Approach**: 3。データ所有は同じ spec に置き、実装・テスト境界だけを明確にする。
- **Rationale**: 重複所有を避けつつ、既存ファイルと独立 unit test に一致する。
- **Trade-offs**: `StudyPage` の内部状態は大きいままだが、ベースライン作成での不要な再実装を避けられる。
- **Follow-up**: 状態機械の抽出は別の承認済み変更として扱う。

### Decision: 共有 parser と上流データを採用し再実装しない

- **Context**: study は Markdown、キーワード記法、章ツリーを利用する。
- **Selected Approach**: `ChapterRow`／`buildTree`／`flatten`、catalog 所有の StablePagedReader、`scanKeywordTokens`／`parseKeywordToken`、`MarkdownView`、authoring 所有の answer normalization／keyword match を許可依存にする。
- **Rationale**: 同じ文書内 ID、順序、正規化の意味を複数 spec が所有することを防ぐ。
- **Trade-offs**: 上流契約変更時は study の再検証が必須になる。
- **Follow-up**: design の Revalidation Triggers を維持する。

### Decision: 未実装ギャップをベースライン完了から分離する

- **Context**: 決定表・steering と現行コードの間に差がある。
- **Selected Approach**: 既存挙動を変更せず、ギャップを design のリスクと `tasks.md` の未完了タスクにする。
- **Rationale**: 実装済み挙動の再実装を避け、未検証事項を完了扱いしない。
- **Trade-offs**: spec 文書は承認済みで実装開始可能だが、未完了タスクが残るため機能完成とは扱わない。
- **Follow-up**: 1.8、7.5、7.6、8.9 に対応するタスクを先に実施する。

## Risks & Mitigations

- 教材／章が取得上限を超えると候補が欠落し得る — 全スコープ問い合わせをページングし、章分散の1,001件 E2Eを追加する。
- 履歴と学習状態が部分成功し得る — 単一トランザクション境界へ統合し、後段失敗を DB test transaction 内で注入する。
- 同一セッションの SRS が古い状態から再計算され得る — 全 SRS 結果をローカル read model へ反映し、誤答後再正解を検証する。
- 別解登録が部分成功し得る — 正答、最新履歴、学習状態を原子的に更新し、各段階失敗で不変を確認する。
- 共有照合の意味が study 内で分岐し得る — authoring の `answer.ts`／`keywordMatch.ts` を直接消費し、選択肢と別解の adapter 回帰を追加する。
- RPC の owner 検証だけが個別実装になる — identity 所有の `RpcSecurityMatrix` を使い、study は予約 migration と業務結果／副作用の4主体ケースだけを所有する。

## References

- `.kiro/steering/product.md` — 学習価値と対象外
- `.kiro/steering/tech.md` — 型安全、ページング、原子的更新、品質ゲート
- `.kiro/steering/structure.md` — feature-first と依存方向
- `.kiro/specs/learning-content-catalog/design.md` — 章 ID、階層、順序、活性状態の上流契約
- `.kiro/specs/markdown-keyword-authoring/design.md` — 文書内 ID、キーワード内容、Markdown 表示の上流契約
- `.kiro/specs/identity-and-access/design.md` — `RpcSecurityMatrix` と RPC 主体検証の上流契約
- `.kiro/steering/contracts.md` — migration 予約、共有 ownership、StablePagedReader
- `spec/tables/12-order.jsonl`〜`18-srs.jsonl` — 既存詳細回帰ケース
