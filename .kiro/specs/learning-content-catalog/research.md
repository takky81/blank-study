# 調査・設計判断

## Summary

- **Feature**: `learning-content-catalog`
- **Discovery Scope**: Extension（既存機能のベースライン化、light discovery）
- **Key Findings**:
  - 科目と教材は `sort_order` を持つ順序付きコレクション、章は `parent_id` を持つ教材内の自己参照ツリーとして既に分離されている。
  - 科目・教材削除は外部キーの cascade で学習資産まで削除する一方、章削除はキーワードの provenance `chapter_id` を null にして履歴を保持し、対象教材 ID を下流 authoring の活性同期へ渡す。
  - 一覧集計と削除影響は行取得上限を避けるため、`material_summary` RPC と `count: exact, head: true` を利用している。

## Research Log

### 既存の利用者フローと回帰資産

- **Context**: 既存挙動を変更せず、要求と設計へ移す必要がある。
- **Sources Consulted**: `spec/tables/02-subject.jsonl`, `03-material.jsonl`, `04-chapter.jsonl`, `e2e/subject.spec.ts`, `material.spec.ts`, `chapter.spec.ts`, `study.spec.ts`
- **Findings**:
  - 決定表は科目14ケース、教材15ケース、章16ケースを定義する。
  - E2E は作成、名称変更、空状態、確認と削除連鎖、順序保存、移動禁止、失敗時の表示／ロールバック、1000件超の集計を検証する。
  - `study.spec.ts` は削除章のキーワード除外と、章順変更が出現順へ反映されることを検証する。
- **Implications**: 下流の学習アルゴリズムは本仕様へ取り込まず、章順とキーワード活性状態だけを提供契約として固定する。

### クライアント境界と純粋ロジック

- **Context**: feature-first の既存責務とタスク境界を維持する。
- **Sources Consulted**: `src/features/subjects/*`, `src/features/materials/*`, `src/features/chapters/*`, `src/features/editor/EditorPage.tsx`, `src/lib/summary.ts`
- **Findings**:
  - `subjects/validation.ts` が trim、空白判定、一次元並べ替えを共有する。
  - 科目・教材・章の DB 操作は各 feature の `api.ts` に集約され、画面は成功後の再読込、二重送信防止、エラー表示を担当する。
  - 章ツリーの構築、子孫判定、循環拒否、部分木移動は `chapters/tree.ts` の純粋関数である。
  - 現行 `chapters/api.ts` から authoring の `syncActiveKeywords` を直接呼ぶ依存は、catalog が `ChapterDeletionResult` を返し authoring consumer が処理する向きへ改める。
- **Implications**: 純粋ポリシー → feature API → 画面という依存を設計の正とする。章本文とキーワード内容は authoring 境界に残し、catalog は preview/result を提供するだけにする。

### 永続化、削除規則、所有者分離

- **Context**: 階層削除と履歴保持の違いを正確に固定する。
- **Sources Consulted**: `supabase/migrations/20260829000000_init.sql`, `20260903000000_material_summary.sql`, `20260904000000_sync_active_keywords.sql`
- **Findings**:
  - `subjects → materials → chapters` は cascade、`chapters.parent_id` も cascade で子孫を削除する。
  - `keywords.material_id` は cascade、`keywords.chapter_id` は `on delete set null` である。学習状態と解答履歴は keyword 削除時だけ cascade する。
  - 全利用者テーブルは `owner_id` と RLS の `USING`／`WITH CHECK` を持つ。所有者境界そのものは上流仕様が所有する。
  - `material_summary` と `sync_active_keywords` は invoker 権限で動作し、認証済みロールだけが実行できる。
- **Implications**: 科目・教材削除と章削除を同じ汎用削除として抽象化しない。削除単位ごとの契約を設計に明示する。

### 検証状況と残る回帰ギャップ

- **Context**: ベースラインタスクの完了状態を直接証拠で判定する。
- **Sources Consulted**: 上記テスト一式、2026-10-10 の対象ユニットテスト実行結果
- **Findings**:
  - `validation.test.ts` 7件と `tree.test.ts` 7件は成功した。
  - `npm run test:e2e -- e2e/subject.spec.ts e2e/material.spec.ts e2e/chapter.spec.ts` はローカル Supabase と Chromium を使って新規実行し、43件すべて成功した。
  - 教材作成時に初期章作成が失敗した場合の補償削除は実装されているが、失敗注入による直接回帰テストがない。
- **Implications**: 実装済みかつ直接証拠のある作業は完了扱いとし、補償削除の回帰だけを未完了タスクとして残す。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|---|---|---|---|---|
| 既存 feature-first を維持 | 科目、教材、章ごとに UI と API を置き、共有純粋ロジックだけを再利用 | コードとテストの所有が明確で変更範囲が小さい | 章 UI は editor 画面へ統合される | 選択 |
| 単一 CatalogService へ統合 | 全操作を新サービスに集約する | 表面的には入口が一つになる | 既存責務を崩し、巨大境界と再実装を生む | 不採用 |
| 汎用ツリー／順序ライブラリを導入 | 外部ライブラリへ操作を委譲する | 一般機能が豊富 | 現行の小さな契約に不要で挙動差のリスクがある | 不採用 |

## Design Decisions

### Decision: 順序付きコレクションと章ツリーを同じ仕様内の別コンポーネントにする

- **Context**: 科目・教材は一次元、章は自己参照階層だが、いずれも教材カタログの順序契約を構成する。
- **Alternatives Considered**:
  1. すべてを汎用ツリーとして扱う
  2. 科目・教材の順序と章ツリーを別コンポーネントとして扱う
- **Selected Approach**: 共有名規則と一次元並べ替えを再利用し、章の循環判定と部分木移動は専用モデルへ留める。
- **Rationale**: 現行実装とテストに一致し、不要な一般化を避けられる。
- **Trade-offs**: 順序保存 API は資源ごとに残るが、削除規則とエラー文脈を明確に保てる。
- **Follow-up**: 順序契約を変更した場合は学習の出現順を再検証する。

### Decision: 削除は資源単位の参照整合性契約として固定する

- **Context**: 科目・教材削除は完全削除、章削除は履歴保持で意味が異なる。
- **Alternatives Considered**:
  1. すべてを cascade 削除する
  2. 現行の外部キー動作と活性同期を組み合わせる
- **Selected Approach**: 科目・教材は cascade、章は子孫だけ cascade し、キーワードを切り離して非活性化する。
- **Rationale**: 既存の学習履歴を保持するプロダクト原則と実装済みスキーマに一致する。
- **Trade-offs**: catalog の削除 result と authoring の lifecycle adapter を同じ統合変更で接続する必要があり、再検証対象が明示的に増える。
- **Follow-up**: authoring は残存章本文を再評価し、別章に doc ID が残れば active 維持、どこにもなければ inactive とする統合 E2E を所有する。

### Decision: 既存の DB 集計を採用し続ける

- **Context**: クライアント取得は1回1000行の上限があり、一覧と削除影響に欠落を許容できない。
- **Alternatives Considered**:
  1. 全行をクライアントへ取得して集計する
  2. DB 集計と exact count を利用する
- **Selected Approach**: `material_summary` RPC と head count を継続利用する。
- **Rationale**: 既存の1001件超 E2E と一致し、転送量を抑えながら正確に数えられる。
- **Trade-offs**: RPC の返却形状が科目・教材 UI の共有契約になる。
- **Follow-up**: キーワード活性条件または due 判定変更時は一覧集計を再検証する。

## Risks & Mitigations

- 教材と初期章の作成は単一 DB transaction ではなく補償削除である — 失敗注入テストで途中教材が残らないことを固定する。
- 並べ替え保存は複数行更新である — 既存の UI ロールバックと再読込回帰を維持し、原子化を要求変更なしに導入しない。
- 章削除後の直接 authoring 呼出しは依存順を逆転させる — catalog は deletion preview/result だけを所有し、authoring の downstream adapter が本文出現数と活性同期を所有する。
- 章・親・教材の整合性をアプリの操作経路だけに委ねると通常 Data API から破壊できる — `20261010000000_catalog_integrity.sql` の複合 FK または同等検証を承認済みギャップとして計画する。

## 横断レビュー追補（2026-10-10）

- `src/lib/paged.ts` の単一 owner を catalog とし、科目・教材・章・章本文・keyword の全件処理へ安定した一意順序を要求した。DB 集約で済む件数処理は引き続き RPC／exact count を使う。
- 親をまたぐ章移動では移動先だけでなく移動元 sibling も再採番する必要がある。現行純粋関数との差を未完了 task として記録した。
- owner／subject／material／parent の複合整合性と `keywords.chapter_id` の provenance 制約を新規 migration へ集約し、identity の4主体セキュリティ契約で再検証する。

## References

- `.kiro/steering/product.md` — プロダクト原則と対象外
- `.kiro/steering/tech.md` — Supabase、RLS、大量件数、テスト方針
- `.kiro/steering/structure.md` — feature-first と依存方向
- `.kiro/specs/learning-content-catalog/brief.md` — 発見フェーズの境界候補
- `spec/tables/02-subject.jsonl` — 科目の回帰決定表
- `spec/tables/03-material.jsonl` — 教材の回帰決定表
- `spec/tables/04-chapter.jsonl` — 章の回帰決定表
