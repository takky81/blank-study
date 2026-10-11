# 調査・設計判断

## 概要

- **Feature**: `material-portability`
- **調査範囲**: 拡張（ブラウンフィールドのベースライン化）
- **主要な知見**:
  - transfer は zip の圧縮、章ツリー変換、キーワード突合、UI 制御、永続化 gateway を分離している。
  - import は `import_material` の1回の呼び出しで教材・章・キーワードを反映し、通常の PostgreSQL 関数トランザクションにより部分反映を避ける。
  - export のキーワード取得は共通 paging を使う一方、章取得は単一要求のため、章が1回の取得上限を超える場合は steering の「出力を欠落させない」を満たさない。
  - RPC は呼出者を `owner_id` に設定し RLS を利用するが、引数の科目・教材・親章が同じ所有者かを検証しないため、既知の他所有者 UUID を外部キーとして指定できる余地がある。
  - 現行 E2E の失敗ケースは RPC 通信を到達前に中断しており、関数内部の途中失敗によるロールバックを直接証明していない。

## 調査記録

### zip と章ツリーの交換契約

- **背景**: export／import の外部データ契約と順序復元条件を確定するため。
- **参照資料**: `src/features/transfer/archive.ts`, `zip.ts`, `archive.test.ts`, `zip.test.ts`, `spec/tables/10-import.jsonl`, `11-export.jsonl`
- **知見**:
  - 子を持つ章はフォルダと `index.md`、葉章は `.md` ファイルになる。
  - 各階層の兄弟順は `010`, `020` のような連番で表し、import 時は数値順に戻す。連番がない場合は名前順になる。
  - zip 圧縮には既存依存 `fflate` 0.8.2 を使い、ファイルシステムへ展開せずメモリ内の path-content map として扱う。
  - `.md` 以外は章として扱わず、Markdown が0件なら拒否する。壊れた zip も日本語エラーに変換する。
- **設計への影響**: 既存の `ArchiveCodec` と `ZipTreeCodec` を変更せず外部契約として固定し、別 manifest や履歴ファイルを追加しない。

### キーワード展開、採番、突合

- **背景**: authoring と portability の共有契約および履歴継続条件を確認するため。
- **参照資料**: `src/features/transfer/api.ts`, `match.ts`, `match.test.ts`, `src/features/editor/api.ts`, `overwrite.ts`, `src/lib/body.ts`, `keyword.ts`, `answer.ts`, `spec/tables/10-import.jsonl`, `11-export.jsonl`
- **知見**:
  - export は authoring の `expandBody` と `KeywordFields` を利用し、章内の最初の出現だけをフル形式にする。
  - import は妥当な既存 ID を保持して突合へ渡し、ID が欠落または規約外の場合だけ `assignDocIds` で既存 ID と同じ import 内の採番済み ID に衝突しない値を割り当て、`collapseBody` で保存形式へ戻す。
  - 同一 ID の正答が正規化後に1件以上重なれば既存行を更新し、正答が重ならない場合と zip 内不整合だけを確認対象にする。
  - 現行 `src/features/transfer/match.ts` は editor 保存も利用する共有契約だが、steering 上の所有者は authoring である。`AnswerNormalization` は `src/lib/answer.ts`、`KeywordMatchPlanner` と `Plan`／`Conflict`／overlap／duplicate は `src/lib/keywordMatch.ts` へ集約する必要がある。
  - `keywords.chapter_id` は最初に定義を取り込んだ章の provenance hint に限り、章所属は各本文の doc ID 出現で決まる。
- **設計への影響**: portability は交換フロー、import target、利用者選択、確定 payload だけを所有する。記法、ID、本文変換、正答正規化、突合 planner と共有型は `markdown-keyword-authoring` の上流契約を消費し、再定義しない。

### import の永続化、安全性、失敗回復

- **背景**: 原子性と所有者分離の実装証拠を確認するため。
- **参照資料**: `supabase/migrations/20260829000000_init.sql`, `20260830000000_import_material.sql`, `20260831000000_grants.sql`, `20260901000000_revoke_rpc_from_anon.sql`, `20260902000000_harden_functions.sql`, `e2e/transfer.spec.ts`, `.kiro/steering/tech.md`
- **知見**:
  - `import_material` は1関数内で教材、親先行の章、キーワードを順に書き、例外時は呼出し全体が rollback される。
  - 関数は invoker 権限、空の `search_path`、schema 修飾、authenticated／service role 限定 execute を採用する。
  - insert 行の `owner_id` は `auth.uid()` だが、`p_subject_id`、`p_material_id`、`p_parent_id` の所有者と相互関係を関数内で確認していない。各表の RLS は行自身の `owner_id` だけを検査するため、外部キー先の所有者一致を保証しない。
  - E2E は通信 abort 後にデータ0件を確認するが、関数内部で章またはキーワードの一部を処理した後の例外は注入していない。
- **設計への影響**: target ownership validation を新 migration で関数入口へ追加し、内部失敗 rollback と cross-owner 拒否を E2E で固定する必要がある。

### 大量件数の完全性

- **背景**: steering の1,000件上限と decision table の export 列10を確認するため。
- **参照資料**: `src/features/editor/api.ts`, `src/lib/paged.ts`, `src/features/transfer/api.ts`, `e2e/transfer.spec.ts`, `.kiro/steering/product.md`, `tech.md`
- **知見**:
  - `listKeywords` は `fetchAll` を使い、1001件の E2E が末尾まで展開されることを証明する。
  - `exportMaterial` の章 query は paging せず、PostgREST 上限を超えた章が静かに欠落する可能性がある。
- **設計への影響**: 章取得も `fetchAll` に合わせ、1001章の export E2E で zip 内件数と末尾章を確認する。

## アーキテクチャパターンの評価

| 選択肢 | 説明 | 強み | リスク／制約 | 備考 |
|---|---|---|---|---|
| codec／gateway／UI／RPC の現行責務分離を維持 | archive、tree、gateway、UI、RPC を既存どおり分け、match は authoring の共有契約を利用する | 実装・テスト証拠を保ちつつ依存方向を正せる | shared 抽出後の adapter 回帰が必要 | 採用 |
| manifest を追加 | zip に JSON manifest を加えて構造を明示する | 将来の versioning が容易 | 現行外部契約を変更し、対象外データを追加する | 不採用 |
| クライアントで複数書込み | RPC を使わず Data API を順次呼ぶ | SQL 関数が不要 | 部分反映を防げず要件7に反する | 不採用 |

## 設計判断

### 判断: 既存 zip 契約を versionless のまま固定する

- **背景**: 現行 zip は Markdown path 自体が階層と順序を表し、manifest を持たない。
- **検討した代替案**:
  1. 現行 path 契約を維持する
  2. manifest と version を新設する
- **採用案**: 現行 path 契約をベースラインとして維持する。
- **理由**: 現行 export/import の往復と29列の決定表をそのまま安定化できる。
- **トレードオフ**: 将来の形式変更では後方互換と revalidation を別途設計する必要がある。
- **後続対応**: zip path、連番、`index.md`、キーワード形式を変更する場合は本 spec と authoring を更新する。

### 判断: import の判断と書込みを二段階に保つ

- **背景**: 利用者確認が必要な conflict と、原子的な確定を両立する必要がある。
- **検討した代替案**:
  1. 読み取り専用 plan の後に1回の確定を行う
  2. parse 中に逐次保存する
- **採用案**: `prepareImport` は plan だけを作り、`runImport` だけが書込みを行う。
- **理由**: cancel と failure の双方で永続データを変更せず、利用者選択を確定 payload に反映できる。
- **トレードオフ**: plan 作成後に既存データが変わる競合は現行では検出しない。
- **後続対応**: 共同編集や version check は本仕様の対象外とする。

### 判断: 既存の RPC を hardening し原子性を直接検証する

- **背景**: 原子的書込みは実装済みだが、target ownership と内部 rollback の証拠が不足する。
- **検討した代替案**:
  1. 既存 RPC へ入口検証を追加し E2E を補う
  2. 新しい別 RPC へ置き換える
- **採用案**: 予約済み migration `20261010020000_harden_import_targets.sql` で同一 signature の関数を置換し、既存 client contract を維持する。
- **理由**: working behavior を再実装せず、安全性と検証ギャップだけを閉じられる。
- **トレードオフ**: migration 適用後は import E2E 全体の再検証が必要になる。
- **後続対応**: authenticated owner、cross-owner target、anon denial、service-role limitation、異なる material の parent、関数内部 constraint failure をテストする。

## リスクと軽減策

- zip を同期的にメモリ処理するため巨大教材では UI を占有し得る — 現行要件に性能閾値がないため変更せず、形式変更時の再検証対象にする。
- authoring の共有 planner 抽出で transfer adapter が分岐する — portability は共有契約を再定義せず、adapter と import E2E で同じ判定結果を再検証する。
- import plan 作成後の並行更新を検出しない — 共同編集は対象外。将来導入時に version contract を追加する。
- chapter paging 修正で取得順が変わる可能性 — `sort_order` と安定 tie-break を設計し、既存順序 E2E を維持する。

## 参照資料

- `.kiro/steering/product.md` — ポータビリティ、破壊的選択、大量件数の原則
- `.kiro/steering/tech.md` — Supabase、paging、RPC、RLS、migration、品質ゲート
- `.kiro/steering/structure.md` — feature-first、共有純粋ロジック、永続化、検証資産の境界
- `.kiro/steering/contracts.md` — authoring 所有の共有突合契約、provenance、catalog 所有の paging、app-shell 所有の共通 UI、RPC 権限と migration 順序
- `spec/tables/10-import.jsonl` — import の19列の回帰契約
- `spec/tables/11-export.jsonl` — export の10列の回帰契約
