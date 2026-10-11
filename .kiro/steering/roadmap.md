# Roadmap

## Overview

第1フェーズでは既存の穴埋め学習アプリを、今後の機能追加に利用できる cc-sdd の要求・設計・タスク体系へ移行した。実装済みコード、DB migration、289 列の決定表、ユニットテスト、E2E テストを証拠として、責務境界ごとのベースライン仕様を作成済みである。第2フェーズでは、この基盤へ構造化設問テストと手動 AI ファイル連携を追加する。

仕様は画面単位ではなく、データと振る舞いを一貫して所有できる業務境界で分ける。既存の決定表は削除せず、詳細な回帰ケースとテスト対応の資産として各仕様から参照する。

## Phase 1 Approach Decision

- **Chosen**: 既存の feature-first 構造に沿うドメイン分割
- **Why**: コード、テスト、DB の所有関係と一致し、機能追加時の変更範囲、依存方向、再検証対象を明確にできるため
- **Rejected alternatives**: 全機能を1つの巨大 spec にする案は変更影響が広すぎる。20個の決定表ごとに分割する案は、同じ利用者フローとデータを複数 spec が重複所有するため採用しない

## Phase 1 Scope

- **In**: 現在実装されている認証、共通 UI、教材階層、Markdown／キーワード編集、zip 入出力、学習セッション、SRS、履歴・集計、およびそれらのデータ・エラー・大量件数・レスポンシブ要件
- **Out**: 新機能の追加、既存挙動の変更、UI リデザイン、DB migration の実行、旧決定表の削除

## Constraints

- 現在のコードとテストで確認できる挙動をベースラインとし、未実装の希望を既存仕様として混ぜない
- 機能の重複所有を避け、共有契約は上流 spec が所有する
- すべての Markdown は日本語で作成する
- `.kiro/specs/` を今後の仕様の正とし、`spec/tables/` は回帰詳細として維持する

## Boundary Strategy

- **Why this split**: 認証、シェル、教材、編集、転送、学習、履歴はそれぞれ独立した変更理由と主要テスト境界を持つ
- **Shared seams to watch**: 所有者境界、教材／章／キーワードの ID、キーワードの活性状態、SRS 定数、1000 件超の取得、保存とインポートで共用する衝突解決
- **Shared contract ownership**: キーワード記法・正答正規化・衝突照合は `markdown-keyword-authoring`、構造整合性・共通ページングは `learning-content-catalog`、共通 UI／submit guard は `app-shell-and-responsive-experience`、RLS／role grant は `identity-and-access` が所有する。詳細は `contracts.md` を参照する

## Specs (dependency order)

ここでの `[x]` は requirements／design／tasks の仕様化と横断整合レビューが完了したことを表す。実装済みかどうかは各 `tasks.md` の子タスクにある `[x]`／`[ ]` を正とする。

- [x] identity-and-access -- ログイン、セッション、ログアウト、RLS と所有者分離。Dependencies: none
- [x] app-shell-and-responsive-experience -- ルーティング、テーマ、共通ナビゲーション、レスポンシブ、共通エラー／アクセシビリティ。Dependencies: identity-and-access
- [x] learning-content-catalog -- 科目、教材、章の作成・変更・並べ替え・削除と階層契約。Dependencies: identity-and-access, app-shell-and-responsive-experience
- [x] markdown-keyword-authoring -- Markdown 編集、キーワード記法、正規化、保存、衝突解決、活性同期。Dependencies: learning-content-catalog
- [x] material-portability -- 教材 zip のエクスポート、教材／章インポート、突合、原子的取り込み。Dependencies: learning-content-catalog, markdown-keyword-authoring
- [x] adaptive-study-session -- 出題範囲・順序・形式・表示・判定・別解・SRS・記録の学習フロー。Dependencies: learning-content-catalog, markdown-keyword-authoring
- [x] learning-insights -- 階層別達成度、苦手キーワード、日別学習量、復習予定の集計表示。Dependencies: learning-content-catalog, adaptive-study-session

### Phase 2: 構造化設問テストと手動 AI 連携

既存キーワードを学習対象として、設問文・模範解答・選択肢・解説を持つ複数の設問を作成し、穴埋めとは別の成績と SRS で学習する。AI の操作は PC 上で利用者が手動で行い、アプリはバージョン付きファイルの安全な出力・検証・原子的取り込みだけを担う。

- **Chosen approach**: 設問マスタ、設問学習、AI 用ファイル交換を3つの責務へ分割する
- **Why**: 編集、学習トランザクション、外部ファイル契約の変更理由を分離し、将来 AI 操作だけを自動化しても設問・履歴モデルを変更せずに済むため
- **Rejected alternatives**: 1仕様への統合は DB、UI、SRS、ファイル検証が大きすぎる。設問管理と交換の統合は、手動 AI ワークフローの変更が通常編集へ波及するため採用しない
- **In**: keyword 1件対設問複数、設問 CRUD、結果画面での疑義／解説追加フラグ、選択／記述／自動切替、専用履歴・SRS、条件抽出、手動 AI 用 export/import、競合 preview、原子的 import
- **Out**: AI API 呼出し、AI 採点、意味類似判定、複数 keyword への同一設問紐付け、import による削除、穴埋め成績との合算
- **Shared seams to watch**: keyword UUID と本文文脈、既存の正答正規化／SRS 基礎規則、設問版管理、1,000件超の DB 集計、owner RLS、ファイル全体の原子性

- [x] structured-question-bank -- keyword に1:Nで紐づく設問、模範解答、選択肢、解説、版、疑義／解説追加フラグを管理する。Dependencies: identity-and-access, app-shell-and-responsive-experience, learning-content-catalog, markdown-keyword-authoring
- [x] structured-question-study -- 設問を選択式・記述式・自動切替で出題し、穴埋めとは別の履歴・正答率・SRSを原子的に記録する。Dependencies: structured-question-bank, adaptive-study-session
- [x] question-generation-exchange -- フラグまたは統計条件で対象をDB集計し、手動AI用ファイルを出力・preview・競合検知・原子的importする。Dependencies: structured-question-bank, structured-question-study, material-portability

## Existing Spec Updates

ここでの `[x]` は既存仕様の requirements／design／tasks へ新機能との統合契約を反映済みであることを表す。追加した実装作業の着手状態は、対象仕様の `tasks.md` にある `[ ]` を正とする。

- [x] app-shell-and-responsive-experience -- feature route registry、共通 navigation composition、`src/App.tsx` への最終接続を唯一所有し、3つの構造化設問 feature が提供するローカル route adapter を登録する未着手実装タスクを追加した。Dependencies: structured-question-bank, structured-question-study, question-generation-exchange
