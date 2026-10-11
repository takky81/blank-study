# 調査・設計判断

## 概要

- **機能**: `markdown-keyword-authoring`
- **調査範囲**: 既存機能の拡張としての軽量ディスカバリ
- **参照した手順**: `kiro-spec-init`、`kiro-spec-requirements`、`kiro-spec-design -y`、`kiro-spec-tasks -y` と各レビューゲート
- **主要な発見**:
  - 編集中の展開形式と DB に置く ID 参照形式は `src/lib/body.ts` の純粋変換で分離され、意味情報の正は `keywords` にある。
  - `src/features/editor/EditorPage.tsx` が編集状態、選択、未保存状態、衝突解決を統合し、`src/features/editor/api.ts` が Supabase 境界を所有する。
  - 正答正規化は `src/lib/answer.ts` にある一方、editor と transfer が使う突合 planner と `Plan`／`Conflict` は `src/features/transfer/match.ts` にあり、feature 間依存を作っている。共有契約の所有者を authoring に定め、`src/lib/keywordMatch.ts` へ抽出する必要がある。
  - 現在の `commitSave` はキーワード upsert、章本文更新、活性同期を別々に実行するため、決定表 08 列7が求める「失敗時にキーワードを更新しない」を全失敗点で保証できない。

## 調査ログ

### 既存 UI と利用者フロー

- **背景**: 決定表 05 とワイヤーフレームが示す編集体験を、現行実装へ対応付ける必要があった。
- **参照元**: `src/features/editor/EditorPage.tsx`、`BodyEditor.tsx`、`Preview.tsx`、`KeywordDialog.tsx`、`src/components/MarkdownView.tsx`、`ConflictDialog.tsx`、`design/Editor*.dc.html`、`KeywordDialog*.dc.html`、`ConflictDialog*.dc.html`
- **確認結果**:
  - 広幅では章・編集・プレビューの3ペイン、狭幅では3タブを使う。
  - 編集領域とプレビューは本文オフセットを共有し、双方の選択からキーワードを作成できる。
  - キーワード編集は本文へ即時反映するが、キーワードマスタへの反映は保存まで遅延する。
  - 未保存の章移動とブラウザ離脱を保護し、保存中はガードと `busy` 状態で重複操作を抑止する。
- **設計への影響**: 画面状態のオーケストレーション、本文入力、プレビュー、編集ダイアログを別責務として維持し、共通 Markdown 表示と共通衝突ダイアログを再利用する。

### 記法、ID、本文変換

- **背景**: 手入力可能な記法と永続化形式の双方向契約を固定する必要があった。
- **参照元**: `src/lib/keyword.ts`、`keyword.test.ts`、`src/lib/body.ts`、`body.test.ts`、`src/lib/markdown.ts`、`markdown.test.ts`、決定表 06〜08
- **確認結果**:
  - 記法スキャナは閉じ括弧、引用符、連続引用符、改行境界を扱い、パーサは順不同の既知キー、未知キー、重複キー、空要素、重複値を正規化する。
  - 文書内 ID は小文字英数字6桁で、同じ教材の既存 ID と同じ保存内の採番済み ID を避ける。
  - 保存時は ID 参照へ縮約し、編集時は章内の最初の出現だけを展開する。
- **設計への影響**: parser／formatter と本文変換を副作用のない共通契約として維持し、UI と永続化から分離する。

### 保存、衝突解決、活性同期

- **背景**: キーワードマスタと本文の整合、および履歴を壊さない上書き判断を確認する必要があった。
- **参照元**: `src/features/editor/api.ts`、`overwrite.ts`、`overwrite.test.ts`、`src/features/transfer/match.ts`、`match.test.ts`、`src/lib/answer.ts`、`src/lib/paged.ts`、`src/lib/submitGuard.ts`、`supabase/migrations/20260829000000_init.sql`、`20260904000000_sync_active_keywords.sql`、決定表 08〜09
- **確認結果**:
  - 保存前準備は全キーワードをページング取得し、ID 採番後に適用可能項目と衝突項目を分ける。
  - ダイアログで明示編集した ID と正答が一部一致する直接編集は自動適用し、正答が一致しない直接編集と同一保存内の不整合を確認対象にする。
  - `keywords` は `(material_id, doc_id)` で一意、`doc_id` と非空 `answers` に DB 制約があり、章削除後もキーワードを残せる。
  - 活性同期 RPC は教材内の ID 集合で `is_active` を一括更新するが、章本文更新やキーワード upsert とは同じトランザクションではない。
  - `keywords.chapter_id` は最後に定義を取り込んだ章を示す provenance hint であり、章所属は各 `chapters.body` の doc ID 出現から求める。同じ doc ID は複数章に出現できる。
- **設計への影響**: 読み取りと衝突解決は現行の二段階を保ち、共有 planner は authoring 所有の `src/lib` へ抽出する。catalog は削除対象 chapter ID／body の preview と削除結果だけを返し、authoring 所有 consumer が preview body の doc ID トークン出現数を返し、削除後は残存本文を再走査して活性を同期する。確定書き込みだけを単一 RPC に集約する余地を未検証ギャップとして明示する。

### 回帰証拠

- **参照元**: `spec/tables/05-editor-ui.jsonl` 17列、`06-keyword-syntax.jsonl` 16列、`07-keyword-id.jsonl` 7列、`08-save-normalize.jsonl` 12列、`09-save-overwrite.jsonl` 9列、関連ユニットテスト、`e2e/editor.spec.ts`
- **新規実行結果**:
  - 2026-10-10 に関連ユニット 6ファイル、87件が成功した。
  - 2026-10-10 に editor E2E 27件がローカル Supabase、Chromium、1 worker で成功した。
  - `npm run spec:coverage` は全決定表 289/289列を参照済みと判定し、対象 05〜09 はそれぞれ 17/17、16/16、7/7、12/12、9/9 だった。
  - `npm run typecheck` は成功した。
- **制約**: カバレッジ検査は決定表からテスト名への参照を確認するもので、各失敗点の原子性や UI 統合レベルの重複送信を直接証明しない。

## アーキテクチャパターン評価

| 選択肢 | 概要 | 強み | リスク／制約 | 判断 |
|---|---|---|---|---|
| 現行 feature-first + 純粋変換 | editor が画面と保存を所有し、記法と本文変換を `src/lib` に置く | 現行コード、テスト、steering と一致する | 保存確定が複数 DB 操作に分かれている | 採用し、確定境界だけ補強する |
| editor 内へ変換を集約 | parser と formatter を editor 専用にする | 一見局所化できる | import／study と共有する記法契約が分岐する | 不採用 |
| transfer に突合契約を残す | 現在の import 実装を移動せず editor から参照する | 移行差分が小さい | 上流 authoring が下流 portability に依存し、所有境界と再検証順が逆転する | 不採用 |
| 新しいクライアント状態管理を導入 | 保存状態を外部ライブラリへ移す | 状態遷移を一般化できる | 現行規模では依存と抽象化が過剰 | 不採用 |

## 設計判断

### 判断: キーワード記法を共有の純粋契約として維持する

- **背景**: editor と下流機能が同じ本文記法を解釈する。
- **選択**: スキャン／パースを `src/lib/keyword.ts`、整形／採番／縮約／展開を `src/lib/body.ts` に維持する。
- **理由**: UI や DB に依存せず、ユニットテストで全境界値を固定できる。
- **トレードオフ**: 記法変更時は editor だけでなく import と study の再検証が必要になる。

### 判断: 保存は準備と確定の二段階を保つ

- **背景**: 上書き衝突は利用者判断を必要とし、確認前に DB を変更できない。
- **選択**: `prepareSave` は読み取り、採番、衝突計画だけを行い、利用者の解決後に `commitSave` が確定する。
- **理由**: キャンセルで永続データを変更しない現行 UI と一致する。
- **トレードオフ**: 準備から確定までに外部更新が入る競合制御は現行範囲に含めない。

### 判断: 正答正規化とキーワード突合を authoring 所有の共有契約へ集約する

- **背景**: editor 保存と import は、正答 overlap、同一 ID の duplicate、適用計画、衝突理由を同じ意味で扱う。
- **選択**: `AnswerNormalization` は `src/lib/answer.ts`、`KeywordMatchPlanner` と `Plan`／`Conflict`／overlap／duplicate 契約は `src/lib/keywordMatch.ts` に置き、editor と transfer は feature adapter から利用する。
- **理由**: authoring を契約所有者にして feature 間 import をなくし、portability と study を下流の利用者として再検証できる。
- **トレードオフ**: 現行 `src/features/transfer/match.ts` とテストの移設、editor adapter と transfer adapter の統合回帰が必要になる。

### 判断: 確定書き込みは単一 DB トランザクションへ集約する

- **背景**: 現行の3段階書き込みは途中失敗時に部分更新を残し得る。
- **選択**: 予約済み migration `20261010010000_save_chapter_with_keywords.sql` の新しい `SECURITY INVOKER` RPC でキーワード upsert、章本文更新、教材内活性同期を1トランザクションにする。
- **理由**: 決定表 08 列7と Requirement 7.3を、クライアント補償ではなく DB の原子性で満たせる。
- **トレードオフ**: JSON 入力の検証、authenticated owner／cross-owner／anon／service-role limitation の identity 回帰、既存 E2E の再検証が必要であり、現時点では未実装タスクとする。

### 判断: 追加ライブラリを導入しない

- **背景**: Markdown と記法は対象範囲が限定された既存パーサで全回帰を満たしている。
- **選択**: 現行の React、Supabase、純粋 TypeScript 実装を継続する。
- **理由**: 新しい依存を採用する根拠がなく、互換性リスクを増やさないため。

## リスクと対策

- 保存 RPC への移行で既存 conflict flow が崩れるリスク — `prepareSave` と `ConflictDialog` は変更せず、確定処理だけを置換して E2E で確認する。
- 文書内 ID の手編集で履歴の意味が変わるリスク — 規約内の別 ID は別キーワードとする契約と差分確認を維持する。
- 1,000件上限による欠落 — `fetchAll` と一括活性同期の E2E を維持する。
- 保存ボタンの UI 統合で重複要求が生じるリスク — 純粋ガードに加え、editor の高速連打 E2E を未検証ギャップとして追加する。
- 共有 planner 抽出で editor と import の判定が分岐するリスク — 同じ `Plan`／`Conflict` fixture を共有契約テストで固定し、authoring、portability、study を再検証する。
- `paged.ts`、`submitGuard.ts`、`ConflictDialog` の変更を authoring が所有すると誤読されるリスク — それぞれ catalog／app-shell の契約として消費し、本仕様は editor adapter と統合テストだけを変更対象にする。
- catalog の章削除へ keyword 更新を埋め込むと依存順が逆転するリスク — catalog は deletion result／material ID までを提供し、authoring-owned lifecycle consumer が残存本文から `is_active` を再同期する。
- 削除確認件数を `keywords.chapter_id` で数えると複数章出現を欠落させるリスク — catalog は対象 chapter ID／body だけを返し、authoring-owned impact adapter が parser 契約で有効な doc ID トークンを章出現単位に数える。

## 参照

- `.kiro/steering/product.md` — プロダクト価値と履歴継続の原則
- `.kiro/steering/tech.md` — React／Supabase、型安全、原子的更新、大量件数、テスト方針
- `.kiro/steering/structure.md` — feature-first 構造と依存方向
- `.kiro/steering/contracts.md` — 共有キーワード契約、provenance、ページング、共通 UI、RPC 権限、migration 順序の所有境界
- `.kiro/specs/markdown-keyword-authoring/brief.md` — discovery の範囲と境界候補
- `spec/tables/05-editor-ui.jsonl`〜`09-save-overwrite.jsonl` — 詳細な回帰判断
